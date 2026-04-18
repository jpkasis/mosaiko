'use client';

import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import Cropper from 'react-easy-crop';
import { motion, AnimatePresence } from 'framer-motion';
import type { GridConfig } from '@/lib/grid-config';
import type { CropArea } from '@/lib/canvas-utils';
import { Button } from '@/components/ui/Button';

// ─── Fit mode types ─────────────────────────────────────────────────────────

type FitMode = 'fill' | 'fit' | 'stretch';

interface FitModeOption {
  mode: FitMode;
  labelKey: 'fitModeFill' | 'fitModeFit' | 'fitModeStretch';
  descKey: 'fitModeFillDesc' | 'fitModeFitDesc' | 'fitModeStretchDesc';
  icon: React.ReactNode;
}

const FIT_MODE_OPTIONS: FitModeOption[] = [
  {
    mode: 'fill',
    labelKey: 'fitModeFill',
    descKey: 'fitModeFillDesc',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <path d="M3 16l5-5 4 4 4-6 5 5" />
      </svg>
    ),
  },
  {
    mode: 'fit',
    labelKey: 'fitModeFit',
    descKey: 'fitModeFitDesc',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <rect x="6" y="7" width="12" height="10" rx="1" />
      </svg>
    ),
  },
  {
    mode: 'stretch',
    labelKey: 'fitModeStretch',
    descKey: 'fitModeStretchDesc',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <path d="M8 12h8M12 8v8" />
        <path d="M8 8l-2-2M16 8l2-2M8 16l-2 2M16 16l2 2" />
      </svg>
    ),
  },
];

// ─── Grid gradient helper ───────────────────────────────────────────────────

function buildGridGradientStyle(
  rows: number,
  cols: number,
  dimStartPct?: number,
  borderInsets?: { top: number; bottom: number; left: number; right: number },
  rowSplitPcts?: number[],
): React.CSSProperties {
  const gradients: string[] = [];

  for (let i = 1; i < cols; i++) {
    const pct = (i / cols) * 100;
    gradients.push(
      `linear-gradient(to right, transparent calc(${pct}% - 1px), rgba(255,255,255,0.4) calc(${pct}% - 0.5px), rgba(255,255,255,0.4) calc(${pct}% + 0.5px), transparent calc(${pct}% + 1px))`,
    );
  }

  const horizontalPcts = rowSplitPcts ?? Array.from({ length: rows - 1 }, (_, i) => ((i + 1) / rows) * 100);
  for (const pct of horizontalPcts) {
    gradients.push(
      `linear-gradient(to bottom, transparent calc(${pct}% - 1px), rgba(255,255,255,0.4) calc(${pct}% - 0.5px), rgba(255,255,255,0.4) calc(${pct}% + 0.5px), transparent calc(${pct}% + 1px))`,
    );
  }

  // Dim non-photo area (e.g. text panels in Studio bottom row)
  if (dimStartPct !== undefined) {
    gradients.push(
      `linear-gradient(to bottom, transparent 0%, transparent ${dimStartPct}%, rgba(237,232,224,0.7) ${dimStartPct}%, rgba(237,232,224,0.7) 100%)`,
    );
  }

  // Dim border areas on all 4 edges (e.g. Polaroid frame borders)
  if (borderInsets) {
    const dim = 'rgba(237,232,224,0.7)';
    const bottomStart = 100 - borderInsets.bottom;
    const rightStart = 100 - borderInsets.right;
    gradients.push(
      `linear-gradient(to bottom, ${dim} 0%, ${dim} ${borderInsets.top}%, transparent ${borderInsets.top}%, transparent ${bottomStart}%, ${dim} ${bottomStart}%, ${dim} 100%)`,
      `linear-gradient(to right, ${dim} 0%, ${dim} ${borderInsets.left}%, transparent ${borderInsets.left}%, transparent ${rightStart}%, ${dim} ${rightStart}%, ${dim} 100%)`,
    );
  }

  if (gradients.length === 0) return {};
  return { backgroundImage: gradients.join(', ') };
}

// ─── Props ──────────────────────────────────────────────────────────────────

interface ImageCropperProps {
  imageSrc: string;
  gridConfig: GridConfig;
  onCropComplete: (croppedArea: CropArea, croppedAreaPixels: CropArea) => void;
  /** Fires during crop/zoom/rotation changes (debounced) for live preview. */
  onCropChange?: (croppedAreaPixels: CropArea) => void;
  /** Override grid overlay rows (e.g. 2 for Arte's photo-only region). */
  overlayRows?: number;
  /** Override grid overlay cols. */
  overlayCols?: number;
  /** Dim crop area below this percentage (e.g. 70 = bottom 30% dimmed for text panels). */
  overlayDimStartPct?: number;
  /** Dim all 4 edges to show frame borders (e.g. Polaroid). Values are % of crop area. */
  overlayBorderInsets?: { top: number; bottom: number; left: number; right: number };
  /** Explicit row split positions as % (overrides even row division). */
  overlayRowSplits?: number[];
  /** Layout rotation controls */
  onLayoutRotate?: () => void;
  canRotateLayout?: boolean;
  layoutRotated?: boolean;
}

export function ImageCropper({
  imageSrc,
  gridConfig,
  onCropComplete,
  onCropChange,
  overlayRows,
  overlayCols,
  overlayDimStartPct,
  overlayBorderInsets,
  overlayRowSplits,
  onLayoutRotate,
  canRotateLayout = false,
  layoutRotated = false,
}: ImageCropperProps) {
  const t = useTranslations('builder');

  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [fitMode, setFitMode] = useState<FitMode>('fill');
  const [finalCropArea, setFinalCropArea] = useState<CropArea | null>(null);
  const [finalCropAreaPixels, setFinalCropAreaPixels] = useState<CropArea | null>(null);
  const [imageSize, setImageSize] = useState<{ width: number; height: number } | null>(null);

  // Refs for debounced live preview
  const cropChangeTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const onCropChangeRef = useRef(onCropChange);
  onCropChangeRef.current = onCropChange;

  // Grid overlay as CSS gradients — renders ON the crop area, not the container
  const gridOverlayStyle = useMemo(
    () => buildGridGradientStyle(overlayRows ?? gridConfig.rows, overlayCols ?? gridConfig.cols, overlayDimStartPct, overlayBorderInsets, overlayRowSplits),
    [gridConfig.rows, gridConfig.cols, overlayRows, overlayCols, overlayDimStartPct, overlayBorderInsets, overlayRowSplits],
  );

  // Load image dimensions for stretch mode
  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      setImageSize({ width: img.naturalWidth, height: img.naturalHeight });
    };
    img.src = imageSrc;
  }, [imageSrc]);

  // Reset crop position when fit mode changes
  useEffect(() => {
    setCrop({ x: 0, y: 0 });
    setZoom(1);
  }, [fitMode]);

  // Clean up debounce timer
  useEffect(() => {
    return () => clearTimeout(cropChangeTimerRef.current);
  }, []);

  const handleCropComplete = useCallback(
    (croppedArea: CropArea, croppedAreaPixels: CropArea) => {
      setFinalCropArea(croppedArea);
      setFinalCropAreaPixels(croppedAreaPixels);

      // Debounced live preview callback
      clearTimeout(cropChangeTimerRef.current);
      cropChangeTimerRef.current = setTimeout(() => {
        onCropChangeRef.current?.(croppedAreaPixels);
      }, 150);
    },
    [],
  );

  // Emit full-image crop area when entering stretch mode (Cropper is hidden)
  useEffect(() => {
    if (fitMode === 'stretch' && imageSize) {
      clearTimeout(cropChangeTimerRef.current);
      const fullArea: CropArea = { x: 0, y: 0, width: imageSize.width, height: imageSize.height };
      onCropChangeRef.current?.(fullArea);
    }
  }, [fitMode, imageSize]);

  const handleRotateLayout = useCallback(() => {
    onLayoutRotate?.();
    setCrop({ x: 0, y: 0 });
    setZoom(1);
  }, [onLayoutRotate]);

  function handleProceed() {
    if (fitMode === 'stretch' && imageSize) {
      // Stretch: use the full image as the crop area
      const fullCropArea: CropArea = { x: 0, y: 0, width: 100, height: 100 };
      const fullCropAreaPixels: CropArea = {
        x: 0,
        y: 0,
        width: imageSize.width,
        height: imageSize.height,
      };
      onCropComplete(fullCropArea, fullCropAreaPixels);
    } else if (finalCropArea && finalCropAreaPixels) {
      onCropComplete(finalCropArea, finalCropAreaPixels);
    }
  }

  const canProceed = fitMode === 'stretch'
    ? imageSize !== null
    : finalCropAreaPixels !== null;

  // Map fit mode to react-easy-crop objectFit
  const objectFit = fitMode === 'fill' ? 'cover' : 'contain';

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
      className="flex flex-col gap-5"
    >
      <div className="text-center">
        <h2 className="font-serif text-2xl font-bold text-charcoal md:text-3xl">
          {t('cropTitle')}
        </h2>
        <p className="mt-2 text-sm text-warm-gray">
          {t('cropHint')}
        </p>
      </div>

      {/* Fit mode selector */}
      <FitModeSelector
        selected={fitMode}
        onChange={setFitMode}
      />

      {/* Layout rotate button */}
      <AnimatePresence>
        {canRotateLayout && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="mx-auto w-full max-w-[500px] overflow-hidden"
          >
            <button
              type="button"
              onClick={handleRotateLayout}
              className="flex min-h-[48px] w-full cursor-pointer items-center justify-center gap-3 rounded-xl border-2 border-terracotta/30 bg-terracotta/5 px-4 py-2.5 text-terracotta transition-all duration-200 hover:border-terracotta hover:bg-terracotta/10 active:scale-[0.98]"
            >
              {/* Rotate icon */}
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="shrink-0"
              >
                <path d="M7.5 3.5L4 7l3.5 3.5" />
                <path d="M4 7h11a4 4 0 0 1 4 4v1" />
                <path d="M16.5 20.5L20 17l-3.5-3.5" />
                <path d="M20 17H9a4 4 0 0 1-4-4v-1" />
              </svg>
              <span className="text-sm font-semibold">{t('rotate')}</span>
              {/* Mini orientation indicator */}
              <div className="flex items-center gap-1.5 text-terracotta/60">
                <motion.div
                  animate={{ opacity: layoutRotated ? 0.4 : 1 }}
                  className="rounded-sm border border-current"
                  style={{ width: 12, height: 16 }}
                />
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="shrink-0">
                  <path d="M5 12h14M12 5l7 7-7 7" />
                </svg>
                <motion.div
                  animate={{ opacity: layoutRotated ? 1 : 0.4 }}
                  className="rounded-sm border border-current"
                  style={{ width: 16, height: 12 }}
                />
              </div>
            </button>
            <p className="mt-1.5 text-center text-xs text-warm-gray">{t('rotateHint')}</p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Cropper container */}
      <div
        className="relative mx-auto w-full overflow-hidden rounded-xl bg-charcoal"
        style={{ aspectRatio: '1', maxWidth: '500px' }}
      >
        {fitMode === 'stretch' ? (
          <StretchPreview
            imageSrc={imageSrc}
            gridConfig={gridConfig}
            hintText={t('fitModeStretchHint')}
            gridOverlayStyle={gridOverlayStyle}
          />
        ) : (
          <Cropper
            key={fitMode}
            image={imageSrc}
            crop={crop}
            zoom={zoom}
            rotation={0}
            aspect={gridConfig.aspect}
            objectFit={objectFit}
            onCropChange={setCrop}
            onZoomChange={setZoom}
            onCropComplete={handleCropComplete}
            showGrid={false}
            style={{
              containerStyle: {
                borderRadius: '0.75rem',
              },
              cropAreaStyle: gridOverlayStyle,
            }}
          />
        )}
      </div>

      {/* Controls — hidden for stretch mode */}
      <AnimatePresence>
        {fitMode !== 'stretch' && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="mx-auto flex w-full max-w-[500px] items-center gap-3 px-2">
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="shrink-0 text-warm-gray"
                aria-hidden="true"
              >
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
                className="zoom-slider h-2 w-full cursor-pointer appearance-none rounded-full bg-light-gray outline-none"
                aria-label="Zoom"
                style={
                  {
                    '--zoom-progress': `${((zoom - 1) / 2) * 100}%`,
                  } as React.CSSProperties
                }
              />

              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="shrink-0 text-warm-gray"
                aria-hidden="true"
              >
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
                <line x1="8" y1="11" x2="14" y2="11" />
                <line x1="11" y1="8" x2="11" y2="14" />
              </svg>

            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Proceed button */}
      <Button
        variant="primary"
        size="lg"
        fullWidth
        onClick={handleProceed}
        disabled={!canProceed}
      >
        {t('stepPreview')}
      </Button>

      {/* Custom slider styles */}
      <style>{`
        .zoom-slider::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 24px;
          height: 24px;
          border-radius: 50%;
          background: var(--terracotta);
          border: 3px solid white;
          box-shadow: 0 2px 6px rgba(0, 0, 0, 0.15);
          cursor: pointer;
          margin-top: -8px;
        }
        .zoom-slider::-moz-range-thumb {
          width: 24px;
          height: 24px;
          border-radius: 50%;
          background: var(--terracotta);
          border: 3px solid white;
          box-shadow: 0 2px 6px rgba(0, 0, 0, 0.15);
          cursor: pointer;
        }
        .zoom-slider::-webkit-slider-runnable-track {
          background: linear-gradient(
            to right,
            var(--terracotta) 0%,
            var(--terracotta) var(--zoom-progress, 0%),
            var(--light-gray) var(--zoom-progress, 0%),
            var(--light-gray) 100%
          );
          border-radius: 9999px;
          height: 8px;
        }
        .zoom-slider::-moz-range-track {
          background: var(--light-gray);
          border-radius: 9999px;
          height: 8px;
        }
        .zoom-slider::-moz-range-progress {
          background: var(--terracotta);
          border-radius: 9999px;
          height: 8px;
        }
        .reactEasyCrop_CropArea {
          transition: width 0.35s cubic-bezier(0.4, 0, 0.2, 1),
                      height 0.35s cubic-bezier(0.4, 0, 0.2, 1);
        }
      `}</style>
    </motion.div>
  );
}

// ─── Fit Mode Selector ──────────────────────────────────────────────────────

function FitModeSelector({
  selected,
  onChange,
}: {
  selected: FitMode;
  onChange: (mode: FitMode) => void;
}) {
  const t = useTranslations('builder');

  return (
    <div className="mx-auto w-full max-w-[500px]">
      <div className="flex gap-2">
        {FIT_MODE_OPTIONS.map(({ mode, labelKey, descKey, icon }) => {
          const isActive = selected === mode;

          return (
            <button
              key={mode}
              onClick={() => onChange(mode)}
              className={[
                'group relative flex flex-1 cursor-pointer flex-col items-center gap-1.5 rounded-xl px-3 py-3 text-center transition-all duration-200',
                isActive
                  ? 'bg-terracotta/10 ring-2 ring-terracotta shadow-sm'
                  : 'bg-cream hover:bg-terracotta/5 ring-1 ring-light-gray',
              ].join(' ')}
              aria-pressed={isActive}
            >
              <div
                className={[
                  'transition-colors duration-200',
                  isActive ? 'text-terracotta' : 'text-warm-gray group-hover:text-charcoal',
                ].join(' ')}
              >
                {icon}
              </div>
              <span
                className={[
                  'text-xs font-semibold leading-tight transition-colors duration-200',
                  isActive ? 'text-terracotta' : 'text-charcoal',
                ].join(' ')}
              >
                {t(labelKey)}
              </span>
              <span
                className={[
                  'text-[10px] leading-tight transition-colors duration-200',
                  isActive ? 'text-terracotta/70' : 'text-warm-gray',
                ].join(' ')}
              >
                {t(descKey)}
              </span>

              {/* Active indicator dot */}
              {isActive && (
                <motion.div
                  layoutId="fitModeIndicator"
                  className="absolute -top-1 -right-1 h-2.5 w-2.5 rounded-full bg-terracotta ring-2 ring-white"
                  transition={{ type: 'spring', stiffness: 400, damping: 25 }}
                />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── Stretch Preview ────────────────────────────────────────────────────────

/** Shows the image stretched to fill the grid aspect ratio (no cropping). */
function StretchPreview({
  imageSrc,
  gridConfig,
  hintText,
  gridOverlayStyle,
}: {
  imageSrc: string;
  gridConfig: GridConfig;
  hintText: string;
  gridOverlayStyle: React.CSSProperties;
}) {
  // Calculate the crop area dimensions to match the grid aspect ratio
  // inside the 1:1 container
  const containerSize = 100; // percentage
  let displayWidth: number;
  let displayHeight: number;

  if (gridConfig.aspect >= 1) {
    // Landscape or square: full width, reduced height
    displayWidth = containerSize;
    displayHeight = containerSize / gridConfig.aspect;
  } else {
    // Portrait: full height, reduced width
    displayWidth = containerSize * gridConfig.aspect;
    displayHeight = containerSize;
  }

  const offsetX = (containerSize - displayWidth) / 2;
  const offsetY = (containerSize - displayHeight) / 2;

  return (
    <div className="absolute inset-0 flex items-center justify-center" style={{ borderRadius: '0.75rem' }}>
      {/* Dark background like the cropper */}
      <div className="absolute inset-0 bg-charcoal" style={{ borderRadius: '0.75rem' }} />

      {/* Dimmed outside area overlay */}
      <div className="absolute inset-0 bg-black/50" style={{ borderRadius: '0.75rem' }} />

      {/* The stretched image in the crop area */}
      <div
        className="absolute overflow-hidden"
        style={{
          left: `${offsetX}%`,
          top: `${offsetY}%`,
          width: `${displayWidth}%`,
          height: `${displayHeight}%`,
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={imageSrc}
          alt=""
          className="h-full w-full"
          style={{ objectFit: 'fill' }}
          draggable={false}
        />
      </div>

      {/* Grid overlay — positioned to match image */}
      <div
        className="pointer-events-none absolute z-10"
        aria-hidden="true"
        style={{
          left: `${offsetX}%`,
          top: `${offsetY}%`,
          width: `${displayWidth}%`,
          height: `${displayHeight}%`,
          ...gridOverlayStyle,
        }}
      />

      {/* Checkerboard pattern hint for distortion */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.3 }}
        className="pointer-events-none absolute bottom-3 left-1/2 z-20 -translate-x-1/2"
      >
        <div className="flex items-center gap-1.5 rounded-full bg-black/60 px-3 py-1.5 backdrop-blur-sm">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
          </svg>
          <span className="text-[10px] font-medium text-white/80">
            {hintText}
          </span>
        </div>
      </motion.div>
    </div>
  );
}

