'use client';

import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import { motion, AnimatePresence } from 'framer-motion';
import { GRID_CONFIGS, formatPrice, type GridSize, type GridConfig } from '@/lib/grid-config';
import { CATEGORY_REGISTRY, type CategoryType, type FloresTheme } from '@/lib/customization-types';
import type { CropArea } from '@/lib/canvas-utils';
import { useCartStore } from '@/lib/cart-store';
import { createPreviewCanvas, getCroppedCanvas, loadImage } from '@/lib/canvas-utils';
import { useBuilderFlow, STEP_I18N_MAP, type StepId } from './useBuilderFlow';
import { CategorySelector } from './CategorySelector';
import { GridSelector } from './GridSelector';
import { PhotoUploader } from './PhotoUploader';
import { ImageCropper } from './ImageCropper';
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

export function MagnetBuilder() {
  const t = useTranslations('builder');
  const tc = useTranslations('common');
  const addItem = useCartStore((s) => s.addItem);
  const searchParams = useSearchParams();

  const initialCategory = (searchParams.get('category') as CategoryType) || null;
  const initialGrid = searchParams.get('grid') ? (Number(searchParams.get('grid')) as GridSize) : null;

  const flow = useBuilderFlow({ initialCategory, initialGrid });

  // ─── Add to Cart ───
  const handleAddToCart = useCallback(async () => {
    if (!flow.imageSrc || !flow.cropAreaPixels || !flow.gridConfig || !flow.selectedCategory) return;

    flow.setIsUploading(true);

    try {
      const image = await loadImage(flow.imageSrc);
      const previewCanvas = createPreviewCanvas(
        image, flow.cropAreaPixels, flow.gridConfig, 120, 4, 0,
      );
      const previewUrl = previewCanvas.toDataURL('image/jpeg', 0.85);

      // Upload original photo to R2
      let photoStorageUrl = '';
      const file = flow.imageFileRef.current;
      if (file) {
        const formData = new FormData();
        formData.append('file', file);
        const uploadRes = await fetch('/api/upload', { method: 'POST', body: formData });
        if (uploadRes.ok) {
          const { publicUrl } = await uploadRes.json();
          photoStorageUrl = publicUrl;
        }
      }

      const meta = CATEGORY_REGISTRY[flow.selectedCategory];
      const categoryLabel = meta.label;

      addItem({
        type: 'custom',
        name: `Mosaico ${categoryLabel} ${flow.gridConfig.size} piezas`,
        gridSize: flow.gridConfig.size,
        gridLayout: { rows: flow.gridConfig.rows, cols: flow.gridConfig.cols },
        price: flow.gridConfig.price,
        quantity: 1,
        previewUrl,
        tileUrls: [],
        customizations: {
          categoryType: flow.selectedCategory,
          textFields: Object.keys(flow.customizationValues).length > 0
            ? flow.customizationValues
            : undefined,
          filterTheme: flow.selectedTheme ?? undefined,
          photoStorageUrl,
          cropArea: flow.cropAreaPixels,
          layoutRotated: flow.layoutRotated,
        },
      });
    } catch {
      if (flow.gridConfig) {
        addItem({
          type: 'custom',
          name: `Mosaico ${flow.gridConfig.size} piezas`,
          gridSize: flow.gridConfig.size,
          gridLayout: { rows: flow.gridConfig.rows, cols: flow.gridConfig.cols },
          price: flow.gridConfig.price,
          quantity: 1,
          previewUrl: '',
          tileUrls: [],
        });
      }
    } finally {
      flow.setIsUploading(false);
    }
  }, [flow, addItem]);

  // ─── Determine allowed grid sizes for current category ───
  const allowedGridSizes = useMemo(() => {
    if (!flow.selectedCategory) return undefined;
    return CATEGORY_REGISTRY[flow.selectedCategory].allowedGridSizes;
  }, [flow.selectedCategory]);

  return (
    <div className="container-mosaiko py-6 md:py-10">
      {/* ── Header ── */}
      <div className="mb-6 text-center md:mb-8">
        <h1 className="font-serif text-3xl font-bold text-charcoal md:text-4xl">
          {t('title')}
        </h1>
        <p className="mt-1 text-sm text-warm-gray md:text-base">
          {t('subtitle')}
        </p>
      </div>

      {/* ── Step Indicator ── */}
      <StepIndicator
        stepSequence={flow.stepSequence}
        currentStepId={flow.currentStepId}
        onStepClick={(stepId) => {
          const idx = flow.stepSequence.indexOf(stepId);
          const currentIdx = flow.stepSequence.indexOf(flow.currentStepId);
          if (idx < currentIdx) flow.goToStep(stepId);
        }}
      />

      {/* ── Two-column layout on desktop ── */}
      <div className="mt-6 md:mt-8 lg:grid lg:grid-cols-[1fr_380px] lg:gap-10 lg:items-start">
        {/* Left column: Active step content */}
        <div className="min-w-0">
          {/* Back button */}
          <AnimatePresence>
            {flow.currentStepIndex > 0 && (
              <motion.button
                initial={{ opacity: 0, x: -12 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -12 }}
                onClick={flow.goBack}
                className="mb-4 flex min-h-[48px] items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-warm-gray transition-colors hover:text-charcoal cursor-pointer"
              >
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <line x1="19" y1="12" x2="5" y2="12" />
                  <polyline points="12 19 5 12 12 5" />
                </svg>
                {tc('back')}
              </motion.button>
            )}
          </AnimatePresence>

          {/* Step content with slide animations */}
          <div className="relative overflow-hidden">
            <AnimatePresence custom={flow.direction} mode="wait">
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
                {flow.currentStepId === 'upload' && flow.gridConfig && (
                  <PhotoUploader
                    onImageSelected={flow.handleImageSelected}
                    gridConfig={flow.gridConfig}
                  />
                )}
                {flow.currentStepId === 'crop' && flow.imageSrc && flow.gridConfig && (
                  <ImageCropper
                    imageSrc={flow.imageSrc}
                    gridConfig={flow.gridConfig}
                    onCropComplete={flow.handleCropComplete}
                    onCropChange={flow.handleCropChange}
                    overlayRows={
                      flow.selectedCategory === 'arte' ? 2
                        : flow.selectedCategory === 'spotify' ? 2
                          : undefined
                    }
                    overlayCols={flow.selectedCategory === 'arte' ? 4 : undefined}
                    overlayDimStartPct={flow.selectedCategory === 'ghibli' ? 70 : undefined}
                    overlaySplitY={flow.selectedCategory === 'polaroid' ? 55.96 : undefined}
                    onLayoutRotate={flow.handleLayoutRotate}
                    canRotateLayout={flow.canRotateLayout}
                    layoutRotated={flow.layoutRotated}
                  />
                )}
                {flow.currentStepId === 'customize' && flow.selectedCategory && (
                  <CustomizationEditor
                    category={flow.selectedCategory}
                    values={flow.customizationValues}
                    onValueChange={flow.setCustomizationValue}
                    selectedTheme={flow.selectedTheme}
                    onThemeChange={flow.setSelectedTheme}
                    onComplete={flow.handleCustomizeComplete}
                  />
                )}
                {flow.currentStepId === 'preview' && flow.imageSrc && flow.cropAreaPixels && flow.gridConfig && (
                  <MagnetPreview
                    imageSrc={flow.imageSrc}
                    cropArea={flow.cropAreaPixels}
                    gridConfig={flow.gridConfig}
                    onAddToCart={handleAddToCart}
                    onReset={flow.handleReset}
                    isUploading={flow.isUploading}
                    categoryType={flow.selectedCategory ?? undefined}
                    textFields={flow.customizationValues}
                    filterTheme={flow.selectedTheme ?? undefined}
                  />
                )}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>

        {/* Right column: Live preview sidebar (desktop only) */}
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
            filterTheme={flow.selectedTheme ?? undefined}
          />
        </aside>
      </div>
    </div>
  );
}

// ─── Step Indicator Component ───────────────────────────────────────────────

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
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
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

            {/* Connector line */}
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

// ─── Live Preview Sidebar (Desktop) ─────────────────────────────────────────

function LivePreviewSidebar({
  currentStepId,
  selectedGrid,
  imageSrc,
  gridConfig,
  liveCropArea,
  cropAreaPixels,
  selectedCategory,
  textFields,
  filterTheme,
}: {
  currentStepId: StepId;
  selectedGrid: GridSize | null;
  imageSrc: string | null;
  gridConfig: GridConfig | null;
  liveCropArea?: CropArea | null;
  cropAreaPixels?: CropArea | null;
  selectedCategory: CategoryType | null;
  textFields?: Record<string, string>;
  filterTheme?: FloresTheme;
}) {
  const t = useTranslations('builder');

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
        {/* Fridge texture */}
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
                <svg
                  width="28"
                  height="28"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  className="text-warm-gray"
                >
                  <rect x="3" y="3" width="7" height="7" />
                  <rect x="14" y="3" width="7" height="7" />
                  <rect x="3" y="14" width="7" height="7" />
                  <rect x="14" y="14" width="7" height="7" />
                </svg>
              </div>
              <p className="text-sm text-warm-gray">{t('subtitle')}</p>
            </motion.div>
          )}

          {selectedGrid && !imageSrc && gridConfig && (
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

          {selectedGrid && imageSrc && gridConfig && (liveCropArea || cropAreaPixels) && (
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
                filterTheme={filterTheme}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Selected grid info */}
      {gridConfig && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-4 flex items-center justify-between"
        >
          <div className="flex flex-col">
            <span className="text-sm text-warm-gray">
              {t(
                `grid${gridConfig.size}` as
                  | 'grid3'
                  | 'grid4'
                  | 'grid6'
                  | 'grid9',
              )}
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

// ─── Helper Sub-components ──────────────────────────────────────────────────

/** Placeholder grid shown before an image is uploaded. */
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

/** Grid that shows the uploaded image split visually. Uses canvas-based
 *  rendering when a crop area is provided, otherwise falls back to CSS. */
function ImagePreviewGrid({
  rows,
  cols,
  imageSrc,
  cropArea,
}: {
  rows: number;
  cols: number;
  imageSrc: string;
  cropArea?: CropArea | null;
}) {
  const [tiles, setTiles] = useState<string[] | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Generate canvas-based tile previews when crop area is available
  useEffect(() => {
    if (!cropArea) {
      setTiles(null);
      return;
    }

    clearTimeout(timerRef.current);
    let cancelled = false;

    timerRef.current = setTimeout(async () => {
      try {
        const image = await loadImage(imageSrc);
        if (cancelled) return;

        const tileSize = 80;
        const totalW = cols * tileSize;
        const totalH = rows * tileSize;
        const cropped = getCroppedCanvas(image, cropArea, totalW, totalH, 0);

        const urls: string[] = [];
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            const tc = document.createElement('canvas');
            tc.width = tileSize;
            tc.height = tileSize;
            const tctx = tc.getContext('2d')!;
            tctx.drawImage(
              cropped,
              c * tileSize, r * tileSize, tileSize, tileSize,
              0, 0, tileSize, tileSize,
            );
            urls.push(tc.toDataURL('image/jpeg', 0.7));
            tc.width = 0;
            tc.height = 0;
          }
        }
        cropped.width = 0;
        cropped.height = 0;

        if (!cancelled) setTiles(urls);
      } catch {
        // Preview is non-critical; silently fall back to CSS
      }
    }, 150);

    return () => {
      cancelled = true;
      clearTimeout(timerRef.current);
    };
  }, [imageSrc, cropArea, rows, cols]);

  // Canvas-based tiles when available
  if (tiles && tiles.length === rows * cols) {
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
        {tiles.map((src, i) => (
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
            className="overflow-hidden rounded-md"
            style={{
              aspectRatio: '1',
              boxShadow: '0 1px 4px rgba(0,0,0,0.1)',
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={src} alt="" className="h-full w-full object-cover" draggable={false} />
          </motion.div>
        ))}
      </div>
    );
  }

  // CSS fallback (no crop area yet)
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
      {Array.from({ length: rows * cols }).map((_, i) => {
        const row = Math.floor(i / cols);
        const col = i % cols;

        return (
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
            className="overflow-hidden rounded-md"
            style={{
              aspectRatio: '1',
              boxShadow: '0 1px 4px rgba(0,0,0,0.1)',
              backgroundImage: `url(${imageSrc})`,
              backgroundSize: `${cols * 100}% ${rows * 100}%`,
              backgroundPosition: `${cols > 1 ? (col / (cols - 1)) * 100 : 50}% ${rows > 1 ? (row / (rows - 1)) * 100 : 50}%`,
            }}
          />
        );
      })}
    </div>
  );
}
