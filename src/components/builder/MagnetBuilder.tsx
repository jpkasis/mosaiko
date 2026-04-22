'use client';

import { useCallback, useEffect, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import { motion, AnimatePresence } from 'framer-motion';
import { formatPrice, type GridSize, type GridConfig } from '@/lib/grid-config';
import {
  CATEGORY_REGISTRY,
  type CategoryType,
  type TonosIntensity,
} from '@/lib/customization-types';
import { CATEGORY_LAYOUTS } from '@/lib/category-layouts';
import { deriveCropperOverlay } from '@/lib/category-layouts/derive';
import type { CropArea } from '@/lib/canvas-utils';
import { useCartStore } from '@/lib/cart-store';
import { BUILDER_RESET_EVENT } from '@/lib/builder-events';
import { buildPrintCustomization } from '@/lib/shopify/customization-serializer';
import {
  useBuilderFlow,
  STEP_I18N_MAP,
  type StepId,
  type TonosIndex,
} from './useBuilderFlow';
import { CategorySelector } from './CategorySelector';
import { GridSelector } from './GridSelector';
import { PhotoUploader } from './PhotoUploader';
import { PhotoUploaderMulti } from './PhotoUploaderMulti';
import { ImageCropper } from './ImageCropper';
import { ImageCropperMulti } from './ImageCropperMulti';
import { MagnetPreview } from './MagnetPreview';

const CustomizationEditor = dynamic(
  () => import('./CustomizationEditor').then((m) => m.CustomizationEditor),
  { ssr: false },
);

const slideVariants = {
  enter: (direction: number) => ({
    x: direction > 0 ? 300 : -300,
    opacity: 0,
  }),
  center: {
    x: 0,
    opacity: 1,
  },
  exit: (direction: number) => ({
    x: direction > 0 ? -300 : 300,
    opacity: 0,
  }),
};

async function uploadPhoto(file: File): Promise<string> {
  const formData = new FormData();
  formData.append('file', file);
  const res = await fetch('/api/upload', { method: 'POST', body: formData });
  if (!res.ok) throw new Error('upload failed');
  const { publicUrl } = await res.json();
  return publicUrl as string;
}

/**
 * Attempts to upload the user's photo to R2. On failure (common in local
 * dev without live R2 creds), falls back to a base64 data URL so the
 * add-to-cart flow still completes. The composite endpoint accepts either.
 * For production the URL path is preferred (smaller request body).
 */
async function uploadOrEncode(file: File): Promise<
  { kind: 'url'; url: string } | { kind: 'data'; data: string }
> {
  try {
    const url = await uploadPhoto(file);
    return { kind: 'url', url };
  } catch {
    const data = await fileToDataUrl(file);
    return { kind: 'data', data };
  }
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('FileReader error'));
    reader.onload = () => resolve(reader.result as string);
    reader.readAsDataURL(file);
  });
}

interface CartCompositeResponse {
  jobId: string;
  categoryType: CategoryType;
  compositeKey: string;
  compositeUrl: string;
  thumbKey: string;
  thumbUrl: string;
  width: number;
  height: number;
}

/**
 * Asks the server to assemble the canonical magnet composite for the
 * current builder state and returns the R2 URLs of the full-res PNG + the
 * JPEG thumbnail. Runs the same Sharp pipeline the order webhook uses, so
 * the cart thumbnail is a faithful preview of what will be printed.
 */
async function requestCartComposite(body: Record<string, unknown>): Promise<CartCompositeResponse> {
  const res = await fetch('/api/cart-composite', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error ?? `cart-composite request failed (${res.status})`);
  }
  return (await res.json()) as CartCompositeResponse;
}

export function MagnetBuilder() {
  const t = useTranslations('builder');
  const tc = useTranslations('common');
  const addItem = useCartStore((s) => s.addItem);
  const searchParams = useSearchParams();

  const initialCategory = (searchParams.get('category') as CategoryType) || null;
  const initialGrid = searchParams.get('grid') ? (Number(searchParams.get('grid')) as GridSize) : null;

  const flow = useBuilderFlow({ initialCategory, initialGrid });

  // Listen for the top-nav "Personalizar" click-while-already-here signal.
  // The header dispatches BUILDER_RESET_EVENT so we can reset to step 1
  // without a URL change. flow.handleReset is a stable useCallback, so
  // rebinding on every render would be wasteful — empty-deps is correct.
  useEffect(() => {
    const onReset = () => flow.handleReset();
    window.addEventListener(BUILDER_RESET_EVENT, onReset);
    return () => window.removeEventListener(BUILDER_RESET_EVENT, onReset);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleAddToCart = useCallback(async () => {
    if (!flow.gridConfig || !flow.selectedCategory) return;
    if (flow.isUploading) return; // guard against double-clicks

    flow.setAddToCartError(null);
    flow.setIsUploading(true);

    try {
      const meta = CATEGORY_REGISTRY[flow.selectedCategory];

      if (flow.selectedCategory === 'tonos') {
        // Tonos: 3 images, 3 crops, intensity.
        const srcs = flow.tonos.imageSrcs;
        const cropAreas = flow.tonos.cropAreas;
        const files = flow.tonos.fileRefs.current;

        if (srcs.some((s) => !s) || cropAreas.some((c) => !c) || files.some((f) => !f)) {
          return;
        }

        const uploaded = await Promise.all(
          (files as File[]).map(uploadOrEncode),
        );
        // If ANY upload failed (falling back to data URL), re-encode all 3 so
        // the endpoint receives a homogeneous shape. Mixing URL/data in a
        // 3-slot array would force the endpoint to branch per slot, which is
        // strictly worse than paying the re-encode cost for the 1-2 that
        // already succeeded.
        const anyFailed = uploaded.some((u) => u.kind !== 'url');
        const photoStorageUrls = uploaded.map((u) => (u.kind === 'url' ? u.url : '')) as [
          string, string, string,
        ];

        const tonosSlots: [
          { fitMode: 'fill' | 'fit' | 'stretch'; rotation: 0 | 90 | 180 | 270 },
          { fitMode: 'fill' | 'fit' | 'stretch'; rotation: 0 | 90 | 180 | 270 },
          { fitMode: 'fill' | 'fit' | 'stretch'; rotation: 0 | 90 | 180 | 270 },
        ] = [
          { fitMode: flow.tonos.slots[0].fitMode, rotation: flow.tonos.slots[0].rotation },
          { fitMode: flow.tonos.slots[1].fitMode, rotation: flow.tonos.slots[1].rotation },
          { fitMode: flow.tonos.slots[2].fitMode, rotation: flow.tonos.slots[2].rotation },
        ];

        const customization = buildPrintCustomization({
          categoryType: 'tonos',
          gridSize: flow.gridConfig.size,
          tonosIntensity: flow.tonos.intensity,
          tonosSlots,
        });

        const compositeBody: Record<string, unknown> = {
          cropAreas: [cropAreas[0]!, cropAreas[1]!, cropAreas[2]!],
          customization,
          rotations: tonosSlots.map((s) => s.rotation) as [number, number, number],
        };
        if (anyFailed) {
          // Encode every slot as a data URL so the endpoint gets a
          // consistent 3-tuple. Re-read already-succeeded uploads from the
          // original File handles — a few MB of base64 on a local fallback
          // path is preferable to mixing URL/data and complicating the API.
          const allDataUrls = (await Promise.all(
            (files as File[]).map((f) => fileToDataUrl(f)),
          )) as [string, string, string];
          compositeBody.photoDataUrls = allDataUrls;
        } else {
          compositeBody.photoUrls = photoStorageUrls;
        }
        const composite = await requestCartComposite(compositeBody);

        addItem({
          type: 'custom',
          name: `Mosaico ${meta.label} ${flow.gridConfig.size} piezas`,
          gridSize: flow.gridConfig.size,
          gridLayout: { rows: flow.gridConfig.rows, cols: flow.gridConfig.cols },
          price: flow.gridConfig.price,
          quantity: 1,
          previewUrl: composite.thumbUrl,
          tileUrls: [],
          customizations: {
            categoryType: 'tonos',
            photoStorageUrls,
            cropAreas: [cropAreas[0]!, cropAreas[1]!, cropAreas[2]!],
            tonosIntensity: flow.tonos.intensity,
            tonosSlots,
            layoutRotated: flow.layoutRotated,
            compositeJobId: composite.jobId,
            compositeKey: composite.compositeKey,
            compositeUrl: composite.compositeUrl,
          },
        });
        return;
      }

      // Single-image categories.
      if (!flow.imageSrc || !flow.cropAreaPixels) return;

      const file = flow.imageFileRef.current;
      if (!file) {
        throw new Error('Missing original photo file');
      }
      const uploaded = await uploadOrEncode(file);
      const photoStorageUrl = uploaded.kind === 'url' ? uploaded.url : '';

      const customization = buildPrintCustomization({
        categoryType: flow.selectedCategory,
        gridSize: flow.gridConfig.size,
        textFields:
          Object.keys(flow.customizationValues).length > 0
            ? flow.customizationValues
            : undefined,
      });

      const composite = await requestCartComposite(
        uploaded.kind === 'url'
          ? { photoUrl: uploaded.url, cropArea: flow.cropAreaPixels, customization }
          : { photoData: uploaded.data, cropArea: flow.cropAreaPixels, customization },
      );

      addItem({
        type: 'custom',
        name: `Mosaico ${meta.label} ${flow.gridConfig.size} piezas`,
        gridSize: flow.gridConfig.size,
        gridLayout: { rows: flow.gridConfig.rows, cols: flow.gridConfig.cols },
        price: flow.gridConfig.price,
        quantity: 1,
        previewUrl: composite.thumbUrl,
        tileUrls: [],
        customizations: {
          categoryType: flow.selectedCategory,
          textFields:
            Object.keys(flow.customizationValues).length > 0
              ? flow.customizationValues
              : undefined,
          photoStorageUrl,
          cropArea: flow.cropAreaPixels,
          layoutRotated: flow.layoutRotated,
          compositeJobId: composite.jobId,
          compositeKey: composite.compositeKey,
          compositeUrl: composite.compositeUrl,
        },
      });
    } catch (error) {
      console.error('[MagnetBuilder] add-to-cart failed:', error);
      flow.setAddToCartError(
        error instanceof Error ? error.message : 'No se pudo preparar tu mosaico. Intenta de nuevo.',
      );
    } finally {
      flow.setIsUploading(false);
    }
  }, [flow, addItem]);

  const allowedGridSizes = useMemo(() => {
    if (!flow.selectedCategory) return undefined;
    return CATEGORY_REGISTRY[flow.selectedCategory].allowedGridSizes;
  }, [flow.selectedCategory]);

  const isTonos = flow.selectedCategory === 'tonos';

  // Cropper overlay guide is layout-defined: each category publishes its
  // overlay rows / cols / row-splits via the contract.
  const cropperOverlay = useMemo(() => {
    if (!flow.selectedCategory || flow.selectedGrid == null) return null;
    return deriveCropperOverlay(
      CATEGORY_LAYOUTS[flow.selectedCategory],
      flow.selectedGrid,
    );
  }, [flow.selectedCategory, flow.selectedGrid]);

  // Stable props for child MagnetPreview / sidebar. Referential identity must
  // be preserved across renders when the underlying arrays / intensity haven't
  // actually changed, otherwise MagnetPreview's effect re-fires infinitely.
  const tonosForPreview = useMemo(() => {
    if (!isTonos) return undefined;
    const rotations = flow.tonos.slots.map((s) => s.rotation) as [number, number, number];
    return {
      imageSrcs: flow.tonos.imageSrcs,
      cropAreas: flow.tonos.cropAreas,
      intensity: flow.tonos.intensity,
      rotations,
    };
  }, [isTonos, flow.tonos.imageSrcs, flow.tonos.cropAreas, flow.tonos.intensity, flow.tonos.slots]);

  const tonosForSidebar = useMemo(() => {
    if (!isTonos) return undefined;
    const { imageSrcs, cropAreas, liveCropAreas, intensity, slots } = flow.tonos;
    const merged = [0, 1, 2].map((i) => liveCropAreas[i] ?? cropAreas[i]) as [
      CropArea | null, CropArea | null, CropArea | null
    ];
    const rotations = slots.map((s) => s.rotation) as [number, number, number];
    return { imageSrcs, cropAreas: merged, intensity, rotations };
  }, [isTonos, flow.tonos.imageSrcs, flow.tonos.cropAreas, flow.tonos.liveCropAreas, flow.tonos.intensity, flow.tonos.slots]);

  return (
    <div className="container-mosaiko py-6 md:py-10">
      <div className="mb-6 text-center md:mb-8">
        <h1 className="font-serif text-3xl font-bold text-charcoal md:text-4xl">
          {t('title')}
        </h1>
        <p className="mt-1 text-sm text-warm-gray md:text-base">
          {t('subtitle')}
        </p>
      </div>

      <StepIndicator
        stepSequence={flow.stepSequence}
        currentStepId={flow.currentStepId}
        onStepClick={(stepId) => {
          const idx = flow.stepSequence.indexOf(stepId);
          const currentIdx = flow.stepSequence.indexOf(flow.currentStepId);
          if (idx < currentIdx) flow.goToStep(stepId);
        }}
      />

      <div className="mt-6 md:mt-8 lg:grid lg:grid-cols-[1fr_380px] lg:gap-10 lg:items-start">
        <div className="min-w-0">
          <AnimatePresence>
            {flow.currentStepIndex > 0 && (
              <motion.button
                initial={{ opacity: 0, x: -12 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -12 }}
                onClick={flow.goBack}
                className="mb-4 flex min-h-[48px] items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-warm-gray transition-colors hover:text-charcoal cursor-pointer"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <line x1="19" y1="12" x2="5" y2="12" />
                  <polyline points="12 19 5 12 12 5" />
                </svg>
                {tc('back')}
              </motion.button>
            )}
          </AnimatePresence>

          <div className="relative overflow-hidden">
            <AnimatePresence custom={flow.direction} mode="wait" initial={false}>
              <motion.div
                key={flow.currentStepId}
                custom={flow.direction}
                variants={slideVariants}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{
                  x: { type: 'spring', stiffness: 300, damping: 30 },
                  opacity: { duration: 0.2 },
                }}
              >
                {flow.currentStepId === 'category' && (
                  <CategorySelector
                    onSelect={flow.handleCategorySelect}
                    selected={flow.selectedCategory}
                  />
                )}
                {flow.currentStepId === 'grid' && (
                  <GridSelector
                    onSelect={flow.handleGridSelect}
                    selected={flow.selectedGrid}
                    allowedSizes={allowedGridSizes}
                  />
                )}

                {/* Upload step */}
                {flow.currentStepId === 'upload' && flow.gridConfig && !isTonos && (
                  <PhotoUploader
                    onImageSelected={flow.handleImageSelected}
                    gridConfig={flow.gridConfig}
                  />
                )}
                {flow.currentStepId === 'upload' && flow.gridConfig && isTonos && (
                  <PhotoUploaderMulti
                    imageSrcs={flow.tonos.imageSrcs}
                    onImageSelected={flow.handleTonosImageSelected}
                    onAllReady={() => {
                      // Require all 3 uploaded
                      if (flow.tonos.imageSrcs.every((s) => s)) {
                        flow.handleTonosImagesSelected(
                          flow.tonos.fileRefs.current as [File, File, File],
                        );
                      }
                    }}
                  />
                )}

                {/* Crop step */}
                {flow.currentStepId === 'crop' && !isTonos && flow.imageSrc && flow.gridConfig && (
                  <ImageCropper
                    imageSrc={flow.imageSrc}
                    gridConfig={flow.gridConfig}
                    onCropComplete={flow.handleCropComplete}
                    onCropChange={flow.handleCropChange}
                    overlayRows={cropperOverlay?.rows}
                    overlayCols={cropperOverlay?.cols}
                    overlayRowSplits={cropperOverlay?.rowSplits}
                    onLayoutRotate={flow.handleLayoutRotate}
                    canRotateLayout={flow.canRotateLayout}
                    layoutRotated={flow.layoutRotated}
                  />
                )}
                {flow.currentStepId === 'crop' && isTonos && flow.gridConfig && (
                  <ImageCropperMulti
                    imageSrcs={flow.tonos.imageSrcs}
                    gridConfig={flow.gridConfig}
                    cropAreas={flow.tonos.cropAreas}
                    intensity={flow.tonos.intensity}
                    slots={flow.tonos.slots}
                    onCropChange={flow.handleTonosCropChange}
                    onCropComplete={flow.handleTonosCropComplete}
                    onIntensityChange={flow.setTonosIntensity}
                    onFitModeChange={flow.setTonosFitMode}
                    onToggleRotation={flow.toggleTonosRotation}
                    onAllDone={flow.advanceFromTonosCrop}
                  />
                )}

                {flow.currentStepId === 'customize' && flow.selectedCategory && (
                  <CustomizationEditor
                    category={flow.selectedCategory}
                    values={flow.customizationValues}
                    onValueChange={flow.setCustomizationValue}
                    onComplete={flow.handleCustomizeComplete}
                  />
                )}
                {flow.currentStepId === 'preview' && flow.gridConfig && (
                  <div className="flex flex-col gap-3">
                    {flow.addToCartError && (
                      <div
                        role="alert"
                        className="rounded-lg border border-error/30 bg-error/5 px-4 py-3 text-sm text-error"
                      >
                        {flow.addToCartError}
                        <button
                          type="button"
                          onClick={() => flow.setAddToCartError(null)}
                          className="ml-3 text-xs font-medium underline underline-offset-2"
                        >
                          Reintentar
                        </button>
                      </div>
                    )}
                    <MagnetPreview
                      imageSrc={isTonos ? null : flow.imageSrc}
                      cropArea={isTonos ? null : flow.cropAreaPixels}
                      gridConfig={flow.gridConfig}
                      onAddToCart={handleAddToCart}
                      onReset={flow.handleReset}
                      isUploading={flow.isUploading}
                      categoryType={flow.selectedCategory ?? undefined}
                      textFields={flow.customizationValues}
                      tonos={tonosForPreview}
                    />
                  </div>
                )}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>

        <aside className="hidden lg:block lg:self-stretch" aria-label="Vista previa en vivo">
          <LivePreviewSidebar
            currentStepId={flow.currentStepId}
            selectedGrid={flow.selectedGrid}
            imageSrc={flow.imageSrc}
            gridConfig={flow.gridConfig}
            liveCropArea={flow.liveCropArea}
            cropAreaPixels={flow.cropAreaPixels}
            selectedCategory={flow.selectedCategory}
            textFields={flow.customizationValues}
            tonos={tonosForSidebar}
          />
        </aside>
      </div>
    </div>
  );
}

// ─── Step Indicator ─────────────────────────────────────────────────────────

function StepIndicator({
  stepSequence,
  currentStepId,
  onStepClick,
}: {
  stepSequence: StepId[];
  currentStepId: StepId;
  onStepClick: (stepId: StepId) => void;
}) {
  const t = useTranslations('builder');
  const currentIdx = stepSequence.indexOf(currentStepId);

  return (
    <div className="flex items-center justify-center gap-0 overflow-x-auto">
      {stepSequence.map((stepId, index) => {
        const isActive = stepId === currentStepId;
        const isCompleted = index < currentIdx;
        const isClickable = index < currentIdx;

        return (
          <div key={stepId} className="flex items-center shrink-0">
            <button
              onClick={() => isClickable && onStepClick(stepId)}
              disabled={!isClickable}
              className={[
                'flex flex-col items-center gap-1.5',
                isClickable ? 'cursor-pointer' : 'cursor-default',
              ].join(' ')}
              aria-label={`${t(STEP_I18N_MAP[stepId])} — Paso ${index + 1}`}
              aria-current={isActive ? 'step' : undefined}
            >
              <div
                className={[
                  'flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold transition-all duration-300',
                  'md:h-10 md:w-10 md:text-sm',
                  isActive
                    ? 'bg-terracotta text-white shadow-md shadow-terracotta/30'
                    : isCompleted
                      ? 'bg-terracotta text-[#efebe0]'
                      : 'bg-light-gray text-warm-gray',
                ].join(' ')}
              >
                {isCompleted ? (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                ) : (
                  index + 1
                )}
              </div>
              <span
                className={[
                  'hidden text-xs font-medium sm:block',
                  isActive
                    ? 'text-terracotta'
                    : isCompleted
                      ? 'text-terracotta'
                      : 'text-warm-gray',
                ].join(' ')}
              >
                {t(STEP_I18N_MAP[stepId])}
              </span>
            </button>

            {index < stepSequence.length - 1 && (
              <div
                className={[
                  'mx-2 h-0.5 w-8 rounded-full transition-colors duration-300 md:mx-3 md:w-12',
                  index < currentIdx ? 'bg-terracotta' : 'bg-light-gray',
                ].join(' ')}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Live Preview Sidebar ───────────────────────────────────────────────────

function LivePreviewSidebar({
  currentStepId,
  selectedGrid,
  imageSrc,
  gridConfig,
  liveCropArea,
  cropAreaPixels,
  selectedCategory,
  textFields,
  tonos,
}: {
  currentStepId: StepId;
  selectedGrid: GridSize | null;
  imageSrc: string | null;
  gridConfig: GridConfig | null;
  liveCropArea?: CropArea | null;
  cropAreaPixels?: CropArea | null;
  selectedCategory: CategoryType | null;
  textFields?: Record<string, string>;
  tonos?: {
    imageSrcs: [string | null, string | null, string | null];
    cropAreas: [CropArea | null, CropArea | null, CropArea | null];
    intensity: TonosIntensity;
    rotations: [number, number, number];
  };
}) {
  const t = useTranslations('builder');

  const isTonos = selectedCategory === 'tonos';
  const tonosReady = !!tonos && tonos.imageSrcs.every((s) => s) && tonos.cropAreas.every((c) => c);

  return (
    <div className="sticky top-[calc(var(--header-height)+1.5rem)] rounded-2xl bg-white p-6 shadow-sm border border-light-gray">
      <h3 className="mb-4 text-center font-serif text-lg font-semibold text-charcoal">
        {t('stepPreview')}
      </h3>

      <div
        className="relative flex items-center justify-center overflow-hidden rounded-xl"
        style={{
          background: 'linear-gradient(145deg, #E8E2DA 0%, #D8D2CA 50%, #E0DAD2 100%)',
          minHeight: '240px',
          boxShadow: 'inset 0 1px 2px rgba(255,255,255,0.3), inset 0 -1px 2px rgba(0,0,0,0.04)',
        }}
      >
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage: 'radial-gradient(circle, #000 1px, transparent 1px)',
            backgroundSize: '8px 8px',
          }}
          aria-hidden="true"
        />

        <AnimatePresence mode="wait">
          {!selectedGrid && (
            <motion.div
              key="empty"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-col items-center gap-3 p-8 text-center"
            >
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-white/60">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-warm-gray">
                  <rect x="3" y="3" width="7" height="7" />
                  <rect x="14" y="3" width="7" height="7" />
                  <rect x="3" y="14" width="7" height="7" />
                  <rect x="14" y="14" width="7" height="7" />
                </svg>
              </div>
              <p className="text-sm text-warm-gray">{t('subtitle')}</p>
            </motion.div>
          )}

          {selectedGrid && !isTonos && !imageSrc && gridConfig && (
            <motion.div
              key="grid-selected"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="p-6"
            >
              <PlaceholderGrid rows={gridConfig.rows} cols={gridConfig.cols} />
            </motion.div>
          )}

          {selectedGrid && isTonos && gridConfig && !tonosReady && (
            <motion.div
              key="tonos-grid-wait"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="p-6"
            >
              <PlaceholderGrid rows={gridConfig.rows} cols={gridConfig.cols} />
            </motion.div>
          )}

          {selectedGrid && !isTonos && imageSrc && gridConfig && (liveCropArea || cropAreaPixels) && (
            <motion.div
              key="has-image"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="relative w-full p-6"
            >
              <MagnetPreview
                compact
                imageSrc={imageSrc}
                cropArea={(liveCropArea ?? cropAreaPixels)!}
                gridConfig={gridConfig}
                categoryType={selectedCategory ?? undefined}
                textFields={textFields}
              />
            </motion.div>
          )}

          {selectedGrid && isTonos && gridConfig && tonosReady && tonos && (
            <motion.div
              key="tonos-preview"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="relative w-full p-6"
            >
              <MagnetPreview
                compact
                imageSrc={null}
                cropArea={null}
                gridConfig={gridConfig}
                categoryType="tonos"
                tonos={tonos}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {gridConfig && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-4 flex items-center justify-between"
        >
          <div className="flex flex-col">
            <span className="text-sm text-warm-gray">
              {t(`grid${gridConfig.size}` as 'grid3' | 'grid4' | 'grid6' | 'grid9')}
            </span>
            {selectedCategory && selectedCategory !== 'mosaicos' && (
              <span className="text-xs text-warm-gray/70">
                {CATEGORY_REGISTRY[selectedCategory].label}
              </span>
            )}
          </div>
          <span className="text-lg font-bold text-charcoal">
            {formatPrice(gridConfig.price)}
          </span>
        </motion.div>
      )}
    </div>
  );
}

function PlaceholderGrid({ rows, cols }: { rows: number; cols: number }) {
  return (
    <div
      className="grid gap-1"
      style={{
        gridTemplateColumns: `repeat(${cols}, 1fr)`,
        gridTemplateRows: `repeat(${rows}, 1fr)`,
        width: `${cols * 80}px`,
        maxWidth: '100%',
      }}
    >
      {Array.from({ length: rows * cols }).map((_, i) => (
        <motion.div
          key={i}
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{
            delay: i * 0.04,
            type: 'spring',
            stiffness: 300,
            damping: 20,
          }}
          className="rounded-md bg-white/50"
          style={{
            aspectRatio: '1',
            boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
          }}
        />
      ))}
    </div>
  );
}
