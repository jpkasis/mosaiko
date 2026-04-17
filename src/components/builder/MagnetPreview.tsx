'use client';

import { useState, useEffect, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { motion } from 'framer-motion';
import { splitImageIntoTiles, getCroppedCanvas, loadImage } from '@/lib/canvas-utils';
import type { CropArea } from '@/lib/canvas-utils';
import { formatPrice, type GridConfig } from '@/lib/grid-config';
import {
  getTileLayout,
  CATEGORY_REGISTRY,
  type CategoryType,
  type TonosIntensity,
  type CategoryCustomization,
} from '@/lib/customization-types';
import { getTonosColumnCSSFilter } from '@/lib/print-pipeline/utils/filter-presets';
import { Button } from '@/components/ui/Button';
import { MosaikoWatermark } from './MosaikoWatermark';
import { SpotifyBarPreview } from './tile-previews/SpotifyBarPreview';
import { ArteInfoPreview } from './tile-previews/ArteInfoPreview';
import { GhibliPanelPreview } from './tile-previews/GhibliPanelPreview';
import { SaveTheDateOverlay } from './tile-previews/SaveTheDateOverlay';

interface TonosInputs {
  imageSrcs: [string | null, string | null, string | null];
  cropAreas: [CropArea | null, CropArea | null, CropArea | null];
  intensity: TonosIntensity;
  rotations?: [number, number, number];
}

// Stable default to avoid recreating an empty object on every render
// (which would defeat useMemo downstream and trigger effect re-runs).
const EMPTY_TEXT_FIELDS: Record<string, string> = Object.freeze({});

interface MagnetPreviewProps {
  imageSrc: string | null;
  cropArea: CropArea | null;
  gridConfig: GridConfig;
  onAddToCart?: () => void;
  onReset?: () => void;
  isUploading?: boolean;
  categoryType?: CategoryType;
  textFields?: Record<string, string>;
  /** Tonos-only: 3 image sources + 3 crop areas + intensity. */
  tonos?: TonosInputs;
  /** Compact mode: render only the tile grid. Used in sidebar preview. */
  compact?: boolean;
}

export function MagnetPreview({
  imageSrc,
  cropArea,
  gridConfig,
  onAddToCart,
  onReset,
  isUploading = false,
  categoryType = 'mosaicos',
  textFields = EMPTY_TEXT_FIELDS,
  tonos,
  compact = false,
}: MagnetPreviewProps) {
  const t = useTranslations('builder');
  const tc = useTranslations('common');

  const [tiles, setTiles] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const customizationConfig = useMemo((): CategoryCustomization => {
    switch (categoryType) {
      case 'spotify':
        return { categoryType: 'spotify', gridSize: 6, songName: textFields.songName || '', artistName: textFields.artistName || '' };
      case 'arte':
        return { categoryType: 'arte', gridSize: 9, title: textFields.title || '', artist: textFields.artist || '', year: textFields.year || '' };
      case 'ghibli':
        return { categoryType: 'ghibli', gridSize: 6, year: textFields.year || '', japaneseText: textFields.japaneseText || '', customText: textFields.customText || '', studioText: textFields.studioText || '' };
      case 'save-the-date':
        return { categoryType: 'save-the-date', gridSize: 9, eventText: textFields.eventText || '', date: textFields.date || '' };
      case 'tonos':
        return { categoryType: 'tonos', gridSize: (gridConfig.size === 9 ? 9 : 3), intensity: tonos?.intensity ?? 'medium' };
      case 'polaroid':
        return { categoryType: 'polaroid', gridSize: 4 };
      default:
        return { categoryType: 'mosaicos', gridSize: gridConfig.size as 3 | 6 | 9 };
    }
  }, [categoryType, textFields, gridConfig.size, tonos?.intensity]);

  const tileLayout = useMemo(() => getTileLayout(customizationConfig), [customizationConfig]);

  const photoTileCount = useMemo(
    () => tileLayout.filter((td) => td.role === 'photo').length,
    [tileLayout],
  );

  // ─── Tile generation ────────────────────────────────────────────────────
  // Produces `tiles[i]` = the data URL for the photo to render at descriptor index i.
  // Non-photo tiles are left empty (special/text-panel tiles render overlays).

  useEffect(() => {
    let cancelled = false;

    async function generateTiles() {
      try {
        setIsLoading(true);
        setError(null);

        // Tonos: crop each of 3 source images once, then fan out to tiles by descriptor.
        if (categoryType === 'tonos' && tonos) {
          const tileSize = 200;
          const perSource: (string | null)[] = [null, null, null];

          await Promise.all(
            (tonos.imageSrcs as (string | null)[]).map(async (src, i) => {
              const area = tonos.cropAreas[i];
              if (!src || !area) return;
              const image = await loadImage(src);
              if (cancelled) return;
              const rotation = tonos.rotations?.[i] ?? 0;
              const canvas = getCroppedCanvas(image, area, tileSize, tileSize, rotation);
              perSource[i] = canvas.toDataURL('image/jpeg', 0.9);
              canvas.width = 0;
              canvas.height = 0;
            }),
          );

          if (cancelled) return;

          const next = tileLayout.map((td) => {
            const idx = td.sourceImageIndex ?? 0;
            return perSource[idx] ?? '';
          });
          setTiles(next);
          return;
        }

        if (!imageSrc || !cropArea) {
          setTiles([]);
          return;
        }

        const image = await loadImage(imageSrc);
        if (cancelled) return;

        // Polaroid: weighted vertical split proportional to transparent areas.
        if (categoryType === 'polaroid') {
          const tileSize = 200;
          const fullCanvas = getCroppedCanvas(image, cropArea, tileSize * 2, tileSize * 2, 0);
          const vSplit = 0.5596;
          const topH = Math.round(tileSize * 2 * vSplit);
          const botH = tileSize * 2 - topH;
          const halfW = tileSize;

          const regions = [
            { sx: 0, sy: 0, sw: halfW, sh: topH },
            { sx: halfW, sy: 0, sw: halfW, sh: topH },
            { sx: 0, sy: topH, sw: halfW, sh: botH },
            { sx: halfW, sy: topH, sw: halfW, sh: botH },
          ];

          const urls: string[] = [];
          for (const r of regions) {
            const tc = document.createElement('canvas');
            tc.width = r.sw;
            tc.height = r.sh;
            const ctx = tc.getContext('2d')!;
            ctx.drawImage(fullCanvas, r.sx, r.sy, r.sw, r.sh, 0, 0, r.sw, r.sh);
            urls.push(tc.toDataURL('image/jpeg', 0.9));
            tc.width = 0;
            tc.height = 0;
          }
          fullCanvas.width = 0;
          fullCanvas.height = 0;
          if (cancelled) return;
          setTiles(urls);
          return;
        }

        const photoRows = categoryType === 'spotify' || categoryType === 'arte' ? 2
          : categoryType === 'ghibli' ? 3
          : gridConfig.rows;
        const photoCols = gridConfig.cols;

        const splitTileCount = categoryType === 'ghibli' ? gridConfig.size : photoTileCount;
        const splitConfig = {
          ...gridConfig,
          size: splitTileCount as typeof gridConfig.size,
          rows: photoRows,
          cols: photoCols,
        };

        const tileDataUrls = splitImageIntoTiles(image, cropArea, splitConfig, 0);
        if (cancelled) return;

        setTiles(tileDataUrls);
      } catch {
        if (!cancelled) {
          setError('Error al generar la vista previa. Intenta de nuevo.');
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    generateTiles();

    return () => {
      cancelled = true;
    };
    // Flatten Tonos inputs so React sees stable primitive/state references
    // instead of an object literal that changes identity each parent render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    imageSrc, cropArea, gridConfig, categoryType, photoTileCount, tileLayout,
    tonos?.imageSrcs[0], tonos?.imageSrcs[1], tonos?.imageSrcs[2],
    tonos?.cropAreas[0], tonos?.cropAreas[1], tonos?.cropAreas[2],
    tonos?.rotations?.[0], tonos?.rotations?.[1], tonos?.rotations?.[2],
    tonos?.intensity,
  ]);

  const priceText = t('addToCart', { price: formatPrice(gridConfig.price) });

  // Precompute photo tile index mapping (layout index → photo tiles array index)
  const photoTileIndexMap = useMemo(() => {
    const map = new Map<number, number>();
    let photoIdx = 0;
    for (const td of tileLayout) {
      if (td.role === 'photo') {
        map.set(td.index, photoIdx++);
      }
    }
    return map;
  }, [tileLayout]);

  // Helper: for Tonos, tiles are already indexed by descriptor index. For other
  // categories, they are indexed by photo-order.
  function tileSrcFor(descriptorIndex: number): string {
    if (categoryType === 'tonos') return tiles[descriptorIndex] ?? '';
    return tiles[photoTileIndexMap.get(descriptorIndex) ?? 0] ?? '';
  }

  // ─── Compact mode (sidebar preview) ─────────────────────────────────────
  if (compact) {
    if (isLoading) {
      return (
        <div className="flex items-center justify-center py-8">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-light-gray border-t-terracotta" />
        </div>
      );
    }
    if (error || tiles.length === 0) return null;

    return (
      <div
        className="relative mx-auto grid"
        style={{
          gridTemplateColumns: `repeat(${gridConfig.cols}, 1fr)`,
          gridTemplateRows: `repeat(${gridConfig.rows}, 1fr)`,
          gap: '0px',
          maxWidth: `${gridConfig.cols * 120}px`,
        }}
      >
        {tileLayout.map((descriptor) => (
          <TileContent
            key={descriptor.index}
            descriptor={descriptor}
            tileSrc={tileSrcFor(descriptor.index)}
            categoryType={categoryType}
            textFields={textFields}
            gridSize={gridConfig.size}
            tonosIntensity={tonos?.intensity ?? 'medium'}
          />
        ))}

        {categoryType !== 'spotify' && categoryType !== 'arte' && categoryType !== 'polaroid' && categoryType !== 'ghibli' && (
          <MosaikoWatermark variant={categoryType === 'tonos' ? 'white' : 'dark'} />
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="text-center">
        <motion.h2
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="font-serif text-2xl font-bold text-charcoal md:text-3xl"
        >
          {t('previewTitle')}
        </motion.h2>
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.15, duration: 0.4 }}
          className="mt-2 text-sm text-warm-gray"
        >
          {t('previewHint')}
        </motion.p>
      </div>

      <div className="mx-auto w-full max-w-[420px]">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.4, delay: 0.1 }}
          className="relative overflow-hidden rounded-2xl p-6 md:p-8"
          style={{
            background: 'linear-gradient(145deg, #E8E2DA 0%, #D8D2CA 50%, #E0DAD2 100%)',
            boxShadow: 'inset 0 1px 2px rgba(255,255,255,0.4), inset 0 -1px 2px rgba(0,0,0,0.05), 0 8px 32px rgba(0,0,0,0.08)',
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

          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-16 gap-4">
              <div className="relative h-12 w-12">
                <div className="absolute inset-0 animate-spin rounded-full border-4 border-light-gray border-t-terracotta" />
              </div>
              <p className="text-sm text-warm-gray">{tc('loading')}</p>
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-error">
                <circle cx="12" cy="12" r="10" />
                <line x1="15" y1="9" x2="9" y2="15" />
                <line x1="9" y1="9" x2="15" y2="15" />
              </svg>
              <p className="text-sm text-error text-center">{error}</p>
              <Button variant="outline" size="sm" onClick={onReset}>
                {t('startOver')}
              </Button>
            </div>
          ) : (
            <div
              className="relative mx-auto grid"
              style={{
                gridTemplateColumns: `repeat(${gridConfig.cols}, 1fr)`,
                gridTemplateRows: `repeat(${gridConfig.rows}, 1fr)`,
                gap: '4px',
                maxWidth: `${gridConfig.cols * 120}px`,
              }}
            >
              {tileLayout.map((descriptor) => (
                <TileContent
                  key={descriptor.index}
                  descriptor={descriptor}
                  tileSrc={tileSrcFor(descriptor.index)}
                  categoryType={categoryType}
                  textFields={textFields}
                  gridSize={gridConfig.size}
                  tonosIntensity={tonos?.intensity ?? 'medium'}
                />
              ))}

              {categoryType !== 'spotify' && categoryType !== 'arte' && categoryType !== 'polaroid' && categoryType !== 'ghibli' && (
                <MosaikoWatermark variant={categoryType === 'tonos' ? 'white' : 'dark'} />
              )}
            </div>
          )}
        </motion.div>
      </div>

      {!isLoading && !error && (
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: tileLayout.length * 0.05 + 0.2, duration: 0.4 }}
          className="flex flex-col gap-4"
        >
          <div className="flex items-center justify-between rounded-xl bg-white px-4 py-3">
            <div className="flex flex-col">
              <span className="text-sm text-warm-gray">
                {t(`grid${gridConfig.size}` as 'grid3' | 'grid4' | 'grid6' | 'grid9')}
              </span>
              <span className="text-xs text-warm-gray">
                {categoryType === 'arte'
                  ? `4×2+1 — ${gridConfig.size} ${tc('pieces')}`
                  : `${gridConfig.rows} x ${gridConfig.cols} — ${gridConfig.size} ${tc('pieces')}`}
                {categoryType !== 'mosaicos' && (
                  <> · {CATEGORY_REGISTRY[categoryType].label}</>
                )}
              </span>
            </div>
            <span className="text-xl font-bold text-charcoal">
              {formatPrice(gridConfig.price)}
            </span>
          </div>

          <Button
            variant="cta"
            size="lg"
            fullWidth
            onClick={onAddToCart}
            disabled={isUploading}
            className="font-serif font-bold"
          >
            {isUploading ? 'Subiendo foto...' : priceText}
          </Button>

          <button
            onClick={onReset}
            className="mx-auto cursor-pointer text-sm font-medium text-warm-gray underline underline-offset-2 transition-colors hover:text-terracotta"
          >
            {t('startOver')}
          </button>
        </motion.div>
      )}
    </div>
  );
}

// ─── Tile content wrapper ───────────────────────────────────────────────────

function TileContent({
  descriptor,
  tileSrc,
  categoryType,
  textFields,
  gridSize,
  tonosIntensity,
}: {
  descriptor: ReturnType<typeof getTileLayout>[number];
  tileSrc: string;
  categoryType: CategoryType;
  textFields: Record<string, string>;
  gridSize: number;
  tonosIntensity: TonosIntensity;
}) {
  const { index, role, label, gridColumn, gridRow } = descriptor;
  const placementStyle: React.CSSProperties | undefined =
    gridColumn || gridRow ? { gridColumn, gridRow } : undefined;

  return (
    <TileWrapper index={index} style={placementStyle}>
      {role === 'special' && categoryType === 'spotify' && (
        <SpotifyBarPreview
          label={label as 'spotify-bar-left' | 'spotify-bar-right'}
          songName={textFields.songName}
          artistName={textFields.artistName}
        />
      )}

      {role === 'special' && categoryType === 'arte' && (
        <ArteInfoPreview
          title={textFields.title}
          artist={textFields.artist}
          year={textFields.year}
        />
      )}

      {role === 'text-panel' && categoryType === 'ghibli' && (() => {
        const isLeft = label === 'ghibli-left';
        const stripStyle = isLeft
          ? { left: '14.15%', top: '0%', width: '85.85%', height: '100%' }
          : { left: '0%', top: '0%', width: '85.69%', height: '100%' };
        return (
          <div className="relative h-full w-full overflow-hidden" style={{ aspectRatio: '1' }}>
            {tileSrc && (
              <img src={tileSrc} alt="" className="absolute" style={stripStyle} draggable={false} />
            )}
            <div className="absolute inset-0 z-10">
              <GhibliPanelPreview
                label={label as 'ghibli-left' | 'ghibli-right'}
                year={textFields.year}
                japaneseText={textFields.japaneseText}
                customText={textFields.customText}
                studioText={textFields.studioText}
              />
            </div>
          </div>
        );
      })()}

      {role === 'photo' && (
        <PhotoTile
          tileSrc={tileSrc}
          index={index}
          totalTiles={gridSize}
          categoryType={categoryType}
          tonosFilter={descriptor.toneColumn
            ? getTonosColumnCSSFilter(descriptor.toneColumn, tonosIntensity)
            : undefined}
          textFields={textFields}
          gridSize={gridSize}
        />
      )}
    </TileWrapper>
  );
}

// ─── Sub-components ─────────────────────────────────────────────────────────

function TileWrapper({
  index,
  children,
  style,
}: {
  index: number;
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.8, rotateZ: -2 + Math.random() * 4 }}
      animate={{ opacity: 1, scale: 1, rotateZ: 0 }}
      transition={{
        type: 'spring',
        stiffness: 260,
        damping: 20,
        delay: index * 0.05,
      }}
      whileHover={{
        scale: 1.04,
        rotateZ: -1 + Math.random() * 2,
        zIndex: 10,
        transition: { duration: 0.2 },
      }}
      className="group relative cursor-default"
      style={style}
    >
      {children}
      <div
        className="absolute -bottom-1 left-1/2 -z-10 h-2 w-4/5 -translate-x-1/2 rounded-full opacity-20"
        style={{
          background: 'radial-gradient(ellipse, rgba(0,0,0,0.3) 0%, transparent 70%)',
        }}
        aria-hidden="true"
      />
    </motion.div>
  );
}

function getSaveTheDateOverlay(
  index: number,
  gridSize: number,
): { textPortion: 'save' | 'the' | 'date' | 'full' | 'date-only'; showDate: boolean } | null {
  if (gridSize === 9) {
    if (index === 0) return { textPortion: 'save', showDate: false };
    if (index === 1) return { textPortion: 'the', showDate: true };
    if (index === 2) return { textPortion: 'date', showDate: false };
  } else if (gridSize === 6) {
    if (index === 0) return { textPortion: 'full', showDate: false };
    if (index === 1) return { textPortion: 'date-only', showDate: true };
  } else if (gridSize === 3) {
    if (index === 2) return { textPortion: 'date-only', showDate: true };
  }
  return null;
}

function PhotoTile({
  tileSrc,
  index,
  totalTiles,
  categoryType,
  tonosFilter,
  textFields,
  gridSize,
}: {
  tileSrc: string;
  index: number;
  totalTiles: number;
  categoryType: CategoryType;
  tonosFilter?: string;
  textFields?: Record<string, string>;
  gridSize?: number;
}) {
  if (!tileSrc) return null;

  const imgElement = (
    <img
      src={tileSrc}
      alt={`Pieza ${index + 1} de ${totalTiles}`}
      className="h-full w-full object-cover"
      draggable={false}
    />
  );

  if (categoryType === 'spotify') {
    const tileNumber = index + 1;
    return (
      <div className="relative overflow-hidden" style={{ aspectRatio: '1' }}>
        {imgElement}
        <img
          src={`/templates/spotify/${tileNumber}.png`}
          alt=""
          className="pointer-events-none absolute inset-0 h-full w-full"
          draggable={false}
        />
      </div>
    );
  }

  if (categoryType === 'polaroid') {
    const tileNumber = index + 1;
    const insets: Record<number, { left: string; top: string; width: string; height: string }> = {
      1: { left: '9.92%', top: '10.41%', width: '90.08%', height: '89.59%' },
      2: { left: '0%', top: '10.41%', width: '90.08%', height: '89.59%' },
      3: { left: '9.92%', top: '0%', width: '90.08%', height: '70.52%' },
      4: { left: '0%', top: '0%', width: '90.08%', height: '70.52%' },
    };
    const area = insets[tileNumber];
    return (
      <div className="relative overflow-hidden" style={{ aspectRatio: '1' }}>
        <img
          src={tileSrc}
          alt={`Pieza ${index + 1} de ${totalTiles}`}
          className="absolute"
          style={{ left: area.left, top: area.top, width: area.width, height: area.height }}
          draggable={false}
        />
        <img
          src={`/templates/polaroid/${tileNumber}.png`}
          alt=""
          className="pointer-events-none relative z-10 h-full w-full"
          draggable={false}
        />
        {tileNumber === 4 && (
          <img
            src="/logos/logo-negro.png"
            alt="Mosaiko"
            className="pointer-events-none absolute z-20"
            style={{ right: '6%', bottom: '6%', height: '8%', width: 'auto', opacity: 0.6 }}
            draggable={false}
          />
        )}
      </div>
    );
  }

  if (categoryType === 'ghibli') {
    const tileNumber = index + 1;
    if (tileNumber > 4) return null;
    const insets: Record<number, { left: string; top: string; width: string; height: string }> = {
      1: { left: '14.15%', top: '14.31%', width: '85.85%', height: '85.53%' },
      2: { left: '0%', top: '14.31%', width: '85.69%', height: '85.53%' },
      3: { left: '14.15%', top: '0%', width: '85.85%', height: '100%' },
      4: { left: '0%', top: '0%', width: '85.69%', height: '100%' },
    };
    const area = insets[tileNumber]!;
    return (
      <div className="relative overflow-hidden" style={{ aspectRatio: '1' }}>
        <img
          src={tileSrc}
          alt={`Pieza ${index + 1} de ${totalTiles}`}
          className="absolute"
          style={{ left: area.left, top: area.top, width: area.width, height: area.height }}
          draggable={false}
        />
        <img
          src={`/templates/studio/${tileNumber}.png`}
          alt=""
          className="pointer-events-none relative z-10 h-full w-full"
          draggable={false}
        />
      </div>
    );
  }

  if (categoryType === 'tonos') {
    return (
      <div
        className="overflow-hidden rounded-md"
        style={{
          aspectRatio: '1',
          boxShadow: '0 2px 8px rgba(0,0,0,0.15), 0 1px 3px rgba(0,0,0,0.1)',
          filter: tonosFilter || 'none',
        }}
      >
        {imgElement}
      </div>
    );
  }

  if (categoryType === 'save-the-date' && textFields) {
    const overlay = getSaveTheDateOverlay(index, gridSize || totalTiles);

    return (
      <div
        className="relative overflow-hidden rounded-md"
        style={{
          aspectRatio: '1',
          boxShadow: '0 2px 8px rgba(0,0,0,0.15), 0 1px 3px rgba(0,0,0,0.1)',
        }}
      >
        {imgElement}
        {overlay && (
          <SaveTheDateOverlay
            textPortion={overlay.textPortion}
            dateText={overlay.showDate ? textFields.date : undefined}
            eventText={textFields.eventText}
          />
        )}
      </div>
    );
  }

  return (
    <div
      className="overflow-hidden rounded-md"
      style={{
        aspectRatio: '1',
        boxShadow: '0 2px 8px rgba(0,0,0,0.15), 0 1px 3px rgba(0,0,0,0.1)',
      }}
    >
      {imgElement}
    </div>
  );
}
