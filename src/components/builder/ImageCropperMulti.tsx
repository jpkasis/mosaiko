'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import Cropper from 'react-easy-crop';
import { motion } from 'framer-motion';
import type { GridConfig } from '@/lib/grid-config';
import type { CropArea } from '@/lib/canvas-utils';
import type { TonosIntensity } from '@/lib/customization-types';
import { Button } from '@/components/ui/Button';
import type {
  MultiPhotoIndex,
  TonosFitMode,
  TonosRotation,
  TonosSlot,
} from './useBuilderFlow';

interface ImageCropperMultiProps {
  imageSrcs: [string | null, string | null, string | null];
  gridConfig: GridConfig;
  cropAreas: [CropArea | null, CropArea | null, CropArea | null];
  intensity: TonosIntensity;
  slots: [TonosSlot, TonosSlot, TonosSlot];
  /** Phase 6.2 — per-slot remount counter. React key={resetSeq[i]} on
   *  each TonosCropSlot forces a fresh mount when reset/replace is
   *  invoked, clearing local crop/zoom/imageSize/debounce in one shot. */
  resetSeq: [number, number, number];
  onCropChange: (index: MultiPhotoIndex, cropAreaPixels: CropArea) => void;
  onCropComplete: (index: MultiPhotoIndex, cropAreaPixels: CropArea) => void;
  onIntensityChange: (intensity: TonosIntensity) => void;
  onFitModeChange: (index: MultiPhotoIndex, mode: TonosFitMode) => void;
  onToggleRotation: (index: MultiPhotoIndex) => void;
  /** Phase 6.2 — per-slot reset (clears fitMode/rotation/cropAreas;
   *  keeps the photo). Undo affordance for one slot. */
  onSlotReset: (index: MultiPhotoIndex) => void;
  /** Phase 6.2 — per-slot photo replace. Wired to a hidden file input
   *  inside each slot's toolbar so users don't have to navigate back
   *  to the upload step to swap one photo. */
  onSlotReplacePhoto: (index: MultiPhotoIndex, file: File) => void;
  onAllDone: () => void;
  /**
   * UAT-1b: which UI controls render. Tonos exposes intensity selector,
   * fit-mode selector, and tone-column swatches; STD-3 ("plain") hides
   * all three because Save the Date multi-photo doesn't have color
   * effects. Defaults to "tonos" for back-compat.
   */
  variant?: 'tonos' | 'plain';
  /** UAT-1b: per-slot labels (Foto 1/2/3 by default). Tonos passes
   *  warm/neutral/cool hints; STD-3 omits hints entirely. */
  slotLabels?: readonly [
    { label: string; hint?: string; swatch?: string },
    { label: string; hint?: string; swatch?: string },
    { label: string; hint?: string; swatch?: string },
  ];
  /** UAT-1b: title + subtitle override (defaults to Tonos copy). */
  title?: string;
  subtitle?: string;
  /**
   * UAT-1b NIT — proceed button label. The parent (MagnetBuilder) derives
   * this from `flow.stepSequence`: "Siguiente" when the next step is
   * `customize` (STD-3) or "Vista previa" when the next step is `preview`
   * (Tonos). Required so TypeScript enforces the prop pass — the cropper
   * must not decide "what's next" on its own. Codex audit fix.
   */
  ctaLabel: string;
}

const INTENSITY_ORDER: TonosIntensity[] = ['mild', 'medium', 'strong'];

const COLUMN_LABELS: Record<MultiPhotoIndex, { label: string; hint: string; swatch: string }> = {
  0: { label: 'Foto 1', hint: 'Cálida', swatch: '#E8A87C' },
  1: { label: 'Foto 2', hint: 'Original', swatch: '#D9CFBF' },
  2: { label: 'Foto 3', hint: 'Fría', swatch: '#7FB5D5' },
};

export function ImageCropperMulti({
  imageSrcs,
  gridConfig,
  cropAreas,
  intensity,
  slots,
  resetSeq,
  onCropChange,
  onCropComplete,
  onIntensityChange,
  onFitModeChange,
  onToggleRotation,
  onSlotReset,
  onSlotReplacePhoto,
  onAllDone,
  variant = 'tonos',
  slotLabels,
  title,
  subtitle,
  ctaLabel,
}: ImageCropperMultiProps) {
  const t = useTranslations('builder');

  const allCropped = cropAreas.every((c) => c !== null);
  const allSrcs = imageSrcs.every((s) => s !== null);

  const heading = title ?? t('tonosCropTitle');
  const hint = subtitle ?? t('tonosCropHint');
  const isTonosVariant = variant === 'tonos';

  // UAT-1b — when not Tonos, render plain "Foto 1/2/3" labels without
  // tone hints. Tonos keeps its warm/neutral/cool affordance.
  const effectiveLabels: Record<MultiPhotoIndex, { label: string; hint?: string; swatch?: string }> = (
    slotLabels
      ? { 0: slotLabels[0], 1: slotLabels[1], 2: slotLabels[2] }
      : isTonosVariant
        ? COLUMN_LABELS
        : {
            0: { label: 'Foto 1' },
            1: { label: 'Foto 2' },
            2: { label: 'Foto 3' },
          }
  );

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
      className="flex flex-col gap-6"
    >
      <div className="text-center">
        <h2 className="font-serif text-2xl font-bold text-charcoal md:text-3xl">
          {heading}
        </h2>
        <p className="mt-2 text-sm text-warm-gray">{hint}</p>
      </div>

      <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
        {imageSrcs.map((src, i) => (
          <TonosCropSlot
            key={`${i}-${resetSeq[i]}`}
            index={i as MultiPhotoIndex}
            imageSrc={src}
            slot={slots[i]}
            onCropChange={onCropChange}
            onCropComplete={onCropComplete}
            onFitModeChange={onFitModeChange}
            onToggleRotation={onToggleRotation}
            onSlotReset={onSlotReset}
            onSlotReplacePhoto={onSlotReplacePhoto}
            label={effectiveLabels[i as MultiPhotoIndex]}
            showFitModeSelector={isTonosVariant}
            showRotation={isTonosVariant}
          />
        ))}
      </div>

      {/* Intensity selector is Tonos-only; STD-3 + future plain
          multi-photo variants don't expose color/intensity controls. */}
      {isTonosVariant && (
        <IntensitySelector selected={intensity} onChange={onIntensityChange} />
      )}

      <Button
        variant="primary"
        size="lg"
        fullWidth
        onClick={onAllDone}
        disabled={!allCropped || !allSrcs}
      >
        {ctaLabel}
      </Button>
    </motion.div>
  );
}

// ─── Slot ───────────────────────────────────────────────────────────────────

function TonosCropSlot({
  index,
  imageSrc,
  slot,
  onCropChange,
  onCropComplete,
  onFitModeChange,
  onToggleRotation,
  onSlotReset,
  onSlotReplacePhoto,
  label: labelOverride,
  showFitModeSelector = true,
  showRotation = true,
}: {
  index: MultiPhotoIndex;
  imageSrc: string | null;
  slot: TonosSlot;
  onCropChange: (index: MultiPhotoIndex, cropAreaPixels: CropArea) => void;
  onCropComplete: (index: MultiPhotoIndex, cropAreaPixels: CropArea) => void;
  onFitModeChange: (index: MultiPhotoIndex, mode: TonosFitMode) => void;
  onToggleRotation: (index: MultiPhotoIndex) => void;
  onSlotReset: (index: MultiPhotoIndex) => void;
  onSlotReplacePhoto: (index: MultiPhotoIndex, file: File) => void;
  label?: { label: string; hint?: string; swatch?: string };
  showFitModeSelector?: boolean;
  /** UAT-1b: STD-3 ("plain") hides per-slot 90° rotation because the
   *  multi-photo print processor doesn't currently apply per-photo
   *  rotations — exposing the button would let the user rotate the
   *  preview without affecting the printed output. Defaults to true. */
  showRotation?: boolean;
}) {
  const t = useTranslations('builder');
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [imageSize, setImageSize] = useState<{ width: number; height: number } | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const lastEmittedRef = useRef<string>('');

  // Reset local crop/zoom when fit mode or rotation changes
  useEffect(() => {
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    lastEmittedRef.current = '';
  }, [slot.fitMode, slot.rotation]);

  useEffect(() => () => clearTimeout(debounceRef.current), []);

  // Load source image dimensions for stretch mode
  useEffect(() => {
    if (!imageSrc) {
      setImageSize(null);
      return;
    }
    const img = new Image();
    img.onload = () => setImageSize({ width: img.naturalWidth, height: img.naturalHeight });
    img.src = imageSrc;
  }, [imageSrc]);

  // Stretch mode: emit a synthetic full-image crop area once dimensions
  // are known. For 90/270 rotation, `processTonos` rotates the source
  // image first, so its rotated dimensions are swapped — the cropArea
  // must match the rotated bounds, not the original. (`cropAndResize`
  // clamps the crop region against the rotated image and would
  // otherwise return a top-left square slice instead of the full
  // rotated image.) Same coordinate convention as `react-easy-crop`,
  // which produces post-rotation cropAreas for the other fit modes.
  useEffect(() => {
    if (slot.fitMode !== 'stretch' || !imageSize) return;
    const isQuarterTurn = slot.rotation === 90 || slot.rotation === 270;
    const rotatedW = isQuarterTurn ? imageSize.height : imageSize.width;
    const rotatedH = isQuarterTurn ? imageSize.width : imageSize.height;
    const fullArea: CropArea = { x: 0, y: 0, width: rotatedW, height: rotatedH };
    const key = `${slot.fitMode}|${slot.rotation}|${rotatedW}x${rotatedH}`;
    if (lastEmittedRef.current === key) return;
    lastEmittedRef.current = key;
    onCropComplete(index, fullArea);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => onCropChange(index, fullArea), 50);
  }, [slot.fitMode, slot.rotation, imageSize, index, onCropChange, onCropComplete]);

  const handleCropComplete = useCallback(
    (_area: CropArea, pixels: CropArea) => {
      onCropComplete(index, pixels);
      clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => onCropChange(index, pixels), 150);
    },
    [index, onCropChange, onCropComplete],
  );

  const meta = labelOverride ?? COLUMN_LABELS[index];
  const objectFit = slot.fitMode === 'fill' ? 'cover' : 'contain';

  // Cropper aspect must match the EFFECTIVE image aspect for `'fit'`
  // mode, otherwise the user emits a 1:1 cropArea and Sharp `'contain'`
  // produces an identity transform — visually identical to `'fill'` and
  // robbing the user of the letterbox they asked for.
  // - `'fill'`: keep aspect=1 (square crop fills the square slot).
  // - `'fit'`:  aspect = source's rotated aspect, so the cropArea
  //             carries the photo's native shape. Sharp `'contain'`
  //             then letterboxes onto the 1:1 print slot.
  // - `'stretch'`: handled by StretchPreview (synthetic full-image
  //             cropArea). Keep that path; this branch only runs for
  //             `'fill'` and `'fit'`.
  // For 90/270 rotation, `react-easy-crop` rotates the displayed image,
  // so the cropper must also see the rotated aspect to draw a frame
  // that covers the visible image at zoom=1.
  const isQuarterTurn = slot.rotation === 90 || slot.rotation === 270;
  const rotatedSourceAspect = imageSize
    ? (isQuarterTurn
        ? imageSize.height / imageSize.width
        : imageSize.width / imageSize.height)
    : 1;
  const cropperAspect = slot.fitMode === 'fit' ? rotatedSourceAspect : 1;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-charcoal">{meta.label}</span>
        {(meta.swatch || meta.hint) && (
          <div className="flex items-center gap-2">
            {meta.swatch && (
              <span
                className="h-3 w-3 rounded-full border border-black/5"
                style={{ backgroundColor: meta.swatch }}
                aria-hidden="true"
              />
            )}
            {meta.hint && <span className="text-xs text-warm-gray">{meta.hint}</span>}
          </div>
        )}
      </div>

      {showFitModeSelector && (
        <FitModeSelector
          selected={slot.fitMode}
          onChange={(m) => onFitModeChange(index, m)}
        />
      )}

      {/* Phase 6.2 — per-slot toolbar. Mirrors the single-image cropper's
          Restablecer + Cambiar foto pattern, scoped to this one slot.
          Only renders when there's a photo (no point in resetting an
          empty slot, and replace-via-input only makes sense once the
          user has at least one photo loaded). */}
      {imageSrc && (
        <SlotToolbar
          index={index}
          onReset={() => onSlotReset(index)}
          onReplaceFile={(file) => onSlotReplacePhoto(index, file)}
          resetLabel={t('cropReset')}
          replaceLabel={t('replacePhoto')}
        />
      )}

      <div
        className="relative w-full overflow-hidden rounded-xl bg-cream"
        style={{ aspectRatio: '1' }}
      >
        {imageSrc ? (
          slot.fitMode === 'stretch' ? (
            <StretchPreview imageSrc={imageSrc} rotation={slot.rotation} />
          ) : slot.fitMode === 'fit' && !imageSize ? (
            // Wait for image dimensions before mounting the Cropper for
            // `'fit'` mode. Mounting with aspect=1 first then
            // remounting with the real aspect would emit a stale 1:1
            // cropArea momentarily.
            <div className="flex h-full w-full items-center justify-center text-sm text-warm-gray">
              Cargando…
            </div>
          ) : (
            <Cropper
              key={`${slot.fitMode}-${slot.rotation}-${cropperAspect.toFixed(4)}`}
              image={imageSrc}
              crop={crop}
              zoom={zoom}
              rotation={slot.rotation}
              aspect={cropperAspect}
              objectFit={objectFit}
              onCropChange={setCrop}
              onZoomChange={setZoom}
              onCropComplete={handleCropComplete}
              showGrid={false}
              style={{ containerStyle: { borderRadius: '0.75rem' } }}
            />
          )
        ) : (
          <div className="flex h-full w-full items-center justify-center text-sm text-white/60">
            Sin imagen
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 px-1">
        {showRotation && (
          <button
            type="button"
            onClick={() => onToggleRotation(index)}
            disabled={!imageSrc}
            aria-label={t('rotate')}
            title={`${t('rotate')} (${slot.rotation}°)`}
            className="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-md border border-light-gray bg-white text-warm-gray transition-colors hover:border-terracotta hover:text-terracotta disabled:cursor-not-allowed disabled:opacity-50"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M7.5 3.5L4 7l3.5 3.5" />
              <path d="M4 7h11a4 4 0 0 1 4 4v1" />
              <path d="M16.5 20.5L20 17l-3.5-3.5" />
              <path d="M20 17H9a4 4 0 0 1-4-4v-1" />
            </svg>
          </button>
        )}

        {slot.fitMode !== 'stretch' && (
          <>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-warm-gray">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
              <line x1="8" y1="11" x2="14" y2="11" />
            </svg>
            <input
              type="range"
              min={1}
              max={3}
              step={0.01}
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
              className="tonos-zoom h-1.5 w-full cursor-pointer appearance-none rounded-full bg-light-gray outline-none"
              aria-label={`Zoom ${meta.label}`}
              style={
                {
                  '--tz-progress': `${((zoom - 1) / 2) * 100}%`,
                } as React.CSSProperties
              }
              disabled={!imageSrc}
            />
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-warm-gray">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
              <line x1="8" y1="11" x2="14" y2="11" />
              <line x1="11" y1="8" x2="11" y2="14" />
            </svg>
          </>
        )}
      </div>

      <style>{`
        .tonos-zoom::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 18px;
          height: 18px;
          border-radius: 50%;
          background: var(--terracotta);
          border: 2px solid white;
          box-shadow: 0 1px 4px rgba(0,0,0,0.15);
          cursor: pointer;
          margin-top: -6px;
        }
        .tonos-zoom::-moz-range-thumb {
          width: 18px;
          height: 18px;
          border-radius: 50%;
          background: var(--terracotta);
          border: 2px solid white;
          box-shadow: 0 1px 4px rgba(0,0,0,0.15);
          cursor: pointer;
        }
        .tonos-zoom::-webkit-slider-runnable-track {
          background: linear-gradient(
            to right,
            var(--terracotta) 0%,
            var(--terracotta) var(--tz-progress, 0%),
            var(--light-gray) var(--tz-progress, 0%),
            var(--light-gray) 100%
          );
          border-radius: 9999px;
          height: 6px;
        }
      `}</style>
    </div>
  );
}

// ─── Compact Fit Mode Selector (per slot) ───────────────────────────────────

const FIT_MODES: { mode: TonosFitMode; labelKey: 'fitModeFill' | 'fitModeFit' | 'fitModeStretch' }[] = [
  { mode: 'fill', labelKey: 'fitModeFill' },
  { mode: 'fit', labelKey: 'fitModeFit' },
  { mode: 'stretch', labelKey: 'fitModeStretch' },
];

function FitModeSelector({
  selected,
  onChange,
}: {
  selected: TonosFitMode;
  onChange: (mode: TonosFitMode) => void;
}) {
  const t = useTranslations('builder');

  return (
    <div className="flex gap-1.5 rounded-lg bg-cream p-1 ring-1 ring-light-gray">
      {FIT_MODES.map(({ mode, labelKey }) => {
        const isActive = selected === mode;
        return (
          <button
            key={mode}
            type="button"
            onClick={() => onChange(mode)}
            className={[
              'flex-1 cursor-pointer rounded-md px-2 py-1.5 text-xs font-semibold transition-colors duration-150',
              isActive
                ? 'bg-white text-terracotta shadow-sm'
                : 'text-warm-gray hover:text-charcoal',
            ].join(' ')}
            aria-pressed={isActive}
          >
            {t(labelKey)}
          </button>
        );
      })}
    </div>
  );
}

// ─── Stretch Preview (per slot, 1:1) ────────────────────────────────────────

function StretchPreview({
  imageSrc,
  rotation,
}: {
  imageSrc: string;
  rotation: TonosRotation;
}) {
  return (
    <div className="absolute inset-0 overflow-hidden">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={imageSrc}
        alt=""
        draggable={false}
        className="h-full w-full select-none"
        style={{
          objectFit: 'fill',
          transform: `rotate(${rotation}deg)`,
          transformOrigin: 'center',
        }}
      />
    </div>
  );
}

// ─── Intensity Selector ─────────────────────────────────────────────────────

function IntensitySelector({
  selected,
  onChange,
}: {
  selected: TonosIntensity;
  onChange: (intensity: TonosIntensity) => void;
}) {
  const t = useTranslations('builder');

  return (
    <div className="mx-auto flex w-full max-w-[500px] flex-col gap-2">
      <span className="text-sm font-medium text-charcoal">
        {t('tonosIntensityLabel')}
      </span>
      <div className="flex gap-2 rounded-xl bg-cream p-1.5 ring-1 ring-light-gray">
        {INTENSITY_ORDER.map((option) => {
          const isActive = selected === option;
          const labelKey = `tonosIntensity${option[0].toUpperCase()}${option.slice(1)}` as
            | 'tonosIntensityMild'
            | 'tonosIntensityMedium'
            | 'tonosIntensityStrong';
          return (
            <button
              key={option}
              type="button"
              onClick={() => onChange(option)}
              className={[
                'relative flex-1 min-h-[44px] cursor-pointer rounded-lg px-3 py-2 text-sm font-semibold transition-colors duration-150',
                isActive
                  ? 'bg-white text-terracotta shadow-sm'
                  : 'text-warm-gray hover:text-charcoal',
              ].join(' ')}
              aria-pressed={isActive}
            >
              {isActive && (
                <motion.span
                  layoutId="tonos-intensity-indicator"
                  className="absolute inset-0 rounded-lg ring-2 ring-terracotta/40"
                  transition={{ type: 'spring', stiffness: 400, damping: 28 }}
                />
              )}
              <span className="relative">{t(labelKey)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// gridConfig param retained for future per-grid behaviour even though aspect is fixed at 1.
export type { ImageCropperMultiProps };

// ─── Per-slot toolbar (Phase 6.2) ──────────────────────────────────────────
//
// Mirrors `src/components/builder/ImageCropper.tsx` toolbar styling: 48 px
// touch targets, neutral white buttons with terracotta hover. Differences
// from the single-image version:
//   - Reset is scoped to ONE slot via `onReset` (no fitMode mutation since
//     fitMode is per-slot in Tonos and the underlying handler resets it).
//   - "Cambiar foto" triggers a per-slot hidden file input rather than
//     navigating back to the upload step. The user stays in the cropper
//     and the OTHER slots' state is preserved.

function SlotToolbar({
  index,
  onReset,
  onReplaceFile,
  resetLabel,
  replaceLabel,
}: {
  index: MultiPhotoIndex;
  onReset: () => void;
  onReplaceFile: (file: File) => void;
  resetLabel: string;
  replaceLabel: string;
}) {
  // Use a per-slot ref so each slot's hidden input is independent.
  const fileInputRef = useRef<HTMLInputElement>(null);
  return (
    <div className="flex w-full gap-2">
      <button
        type="button"
        onClick={onReset}
        aria-label={`${resetLabel} foto ${index + 1}`}
        className="flex min-h-[44px] flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-light-gray bg-white px-2 text-xs font-medium text-warm-gray transition-colors hover:border-terracotta/40 hover:text-charcoal active:scale-[0.98]"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M3 12a9 9 0 1 0 3-6.7" />
          <polyline points="3 4 3 10 9 10" />
        </svg>
        {resetLabel}
      </button>
      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        aria-label={`${replaceLabel} foto ${index + 1}`}
        className="flex min-h-[44px] flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-light-gray bg-white px-2 text-xs font-medium text-warm-gray transition-colors hover:border-terracotta/40 hover:text-charcoal active:scale-[0.98]"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
          <circle cx="8.5" cy="8.5" r="1.5" />
          <polyline points="21 15 16 10 5 21" />
        </svg>
        {replaceLabel}
      </button>
      {/* Hidden — clicked programmatically via the button above. Per-slot
          ref means slot 1's button can't accidentally trigger slot 2's input.
          aria-hidden because className='hidden' makes display:none which
          already excludes it from the AT tree. The visible buttons above
          carry the slot-specific aria-labels. */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        aria-hidden="true"
        tabIndex={-1}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onReplaceFile(file);
          // Clear the input value so picking the same file twice still fires.
          e.target.value = '';
        }}
      />
    </div>
  );
}
