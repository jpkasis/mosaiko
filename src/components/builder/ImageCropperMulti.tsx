'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import Cropper from 'react-easy-crop';
import { motion } from 'framer-motion';
import type { GridConfig } from '@/lib/grid-config';
import type { CropArea } from '@/lib/canvas-utils';
import type { TonosIntensity } from '@/lib/customization-types';
import { Button } from '@/components/ui/Button';
import type { TonosIndex } from './useBuilderFlow';

interface ImageCropperMultiProps {
  imageSrcs: [string | null, string | null, string | null];
  gridConfig: GridConfig;
  cropAreas: [CropArea | null, CropArea | null, CropArea | null];
  intensity: TonosIntensity;
  onCropChange: (index: TonosIndex, cropAreaPixels: CropArea) => void;
  onCropComplete: (index: TonosIndex, cropAreaPixels: CropArea) => void;
  onIntensityChange: (intensity: TonosIntensity) => void;
  onAllDone: () => void;
}

const INTENSITY_ORDER: TonosIntensity[] = ['mild', 'medium', 'strong'];

const COLUMN_LABELS: Record<TonosIndex, { label: string; hint: string; swatch: string }> = {
  0: { label: 'Foto 1', hint: 'Cálida', swatch: '#E8A87C' },
  1: { label: 'Foto 2', hint: 'Original', swatch: '#D9CFBF' },
  2: { label: 'Foto 3', hint: 'Fría', swatch: '#7FB5D5' },
};

export function ImageCropperMulti({
  imageSrcs,
  gridConfig,
  cropAreas,
  intensity,
  onCropChange,
  onCropComplete,
  onIntensityChange,
  onAllDone,
}: ImageCropperMultiProps) {
  const t = useTranslations('builder');

  const allCropped = cropAreas.every((c) => c !== null);
  const allSrcs = imageSrcs.every((s) => s !== null);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
      className="flex flex-col gap-6"
    >
      <div className="text-center">
        <h2 className="font-serif text-2xl font-bold text-charcoal md:text-3xl">
          {t('tonosCropTitle')}
        </h2>
        <p className="mt-2 text-sm text-warm-gray">{t('tonosCropHint')}</p>
      </div>

      <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
        {imageSrcs.map((src, i) => (
          <TonosCropSlot
            key={i}
            index={i as TonosIndex}
            imageSrc={src}
            // Each Tonos tile is 1:1 regardless of grid (3-tile or 9-tile).
            aspect={1}
            onCropChange={onCropChange}
            onCropComplete={onCropComplete}
          />
        ))}
      </div>

      <IntensitySelector selected={intensity} onChange={onIntensityChange} />

      <Button
        variant="primary"
        size="lg"
        fullWidth
        onClick={onAllDone}
        disabled={!allCropped || !allSrcs}
      >
        {t('stepPreview')}
      </Button>
    </motion.div>
  );
}

// ─── Slot ───────────────────────────────────────────────────────────────────

function TonosCropSlot({
  index,
  imageSrc,
  aspect,
  onCropChange,
  onCropComplete,
}: {
  index: TonosIndex;
  imageSrc: string | null;
  aspect: number;
  onCropChange: (index: TonosIndex, cropAreaPixels: CropArea) => void;
  onCropComplete: (index: TonosIndex, cropAreaPixels: CropArea) => void;
}) {
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(debounceRef.current), []);

  const handleCropComplete = useCallback(
    (_area: CropArea, pixels: CropArea) => {
      onCropComplete(index, pixels);
      clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => onCropChange(index, pixels), 150);
    },
    [index, onCropChange, onCropComplete],
  );

  const meta = COLUMN_LABELS[index];

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-charcoal">{meta.label}</span>
        <div className="flex items-center gap-2">
          <span
            className="h-3 w-3 rounded-full border border-black/5"
            style={{ backgroundColor: meta.swatch }}
            aria-hidden="true"
          />
          <span className="text-xs text-warm-gray">{meta.hint}</span>
        </div>
      </div>

      <div
        className="relative w-full overflow-hidden rounded-xl bg-charcoal"
        style={{ aspectRatio: '1' }}
      >
        {imageSrc ? (
          <Cropper
            image={imageSrc}
            crop={crop}
            zoom={zoom}
            rotation={0}
            aspect={aspect}
            objectFit="cover"
            onCropChange={setCrop}
            onZoomChange={setZoom}
            onCropComplete={handleCropComplete}
            showGrid={false}
            style={{ containerStyle: { borderRadius: '0.75rem' } }}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-sm text-white/60">
            Sin imagen
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 px-1">
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
