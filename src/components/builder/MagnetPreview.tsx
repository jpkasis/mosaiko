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
  type FloresTheme,
  type CategoryCustomization,
} from '@/lib/customization-types';
import { getFloresCSSFilters } from '@/lib/print-pipeline/utils/filter-presets';
import { Button } from '@/components/ui/Button';
import { MosaikoWatermark } from './MosaikoWatermark';
import { SpotifyBarPreview } from './tile-previews/SpotifyBarPreview';
import { ArteInfoPreview } from './tile-previews/ArteInfoPreview';
import { GhibliPanelPreview } from './tile-previews/GhibliPanelPreview';
import { SaveTheDateOverlay } from './tile-previews/SaveTheDateOverlay';
import { PolaroidFrame } from './tile-previews/PolaroidFrame';

interface MagnetPreviewProps {
  imageSrc: string;
  cropArea: CropArea;
  gridConfig: GridConfig;
  onAddToCart?: () => void;
  onReset?: () => void;
  isUploading?: boolean;
  categoryType?: CategoryType;
  textFields?: Record<string, string>;
  filterTheme?: FloresTheme;
  /** Compact mode: render only the tile grid (no heading, fridge wrapper, buttons). Used in sidebar preview. */
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
  textFields = {},
  filterTheme,
  compact = false,
}: MagnetPreviewProps) {
  const t = useTranslations('builder');
  const tc = useTranslations('common');

  const [tiles, setTiles] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Build the CategoryCustomization for getTileLayout
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
      case 'flores':
        return { categoryType: 'flores', gridSize: gridConfig.size as 3 | 6 | 9, theme: filterTheme || 'calido' };
      case 'polaroid':
        return { categoryType: 'polaroid', gridSize: 4 };
      default:
        return { categoryType: 'mosaicos', gridSize: gridConfig.size as 3 | 6 | 9 };
    }
  }, [categoryType, textFields, gridConfig.size, filterTheme]);

  const tileLayout = useMemo(() => getTileLayout(customizationConfig), [customizationConfig]);

  // Get Flores CSS filters if applicable
  const floresFilters = useMemo(() => {
    if (categoryType !== 'flores' || !filterTheme) return null;
    return getFloresCSSFilters(filterTheme, gridConfig.size);
  }, [categoryType, filterTheme, gridConfig.size]);

  // Count how many photo tiles we need (non-special tiles)
  const photoTileCount = useMemo(
    () => tileLayout.filter((td) => td.role === 'photo').length,
    [tileLayout],
  );

  useEffect(() => {
    let cancelled = false;

    async function generateTiles() {
      try {
        setIsLoading(true);
        setError(null);

        const image = await loadImage(imageSrc);
        if (cancelled) return;

        // Flores/Tonos: same image duplicated on every tile (NOT split)
        if (categoryType === 'flores') {
          const tileSize = 200; // preview resolution per tile
          const singleCanvas = getCroppedCanvas(image, cropArea, tileSize, tileSize, 0);
          const singleUrl = singleCanvas.toDataURL('image/jpeg', 0.9);
          singleCanvas.width = 0;
          singleCanvas.height = 0;
          if (cancelled) return;
          // Duplicate same image for all tiles
          setTiles(Array.from({ length: photoTileCount }, () => singleUrl));
          return;
        }

        // For categories with special tiles, we only split the photo portion
        // Ghibli: split full 3×2 grid (6 tiles) so photo extends into bottom tiles' strip
        const photoRows = categoryType === 'spotify' || categoryType === 'arte' ? 2
          : categoryType === 'ghibli' ? 3
          : gridConfig.rows;
        const photoCols = gridConfig.cols;

        // For ghibli, split the full grid (6 tiles); others split only photo tiles
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
  }, [imageSrc, cropArea, gridConfig, categoryType, photoTileCount]);

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

  // Compact mode: render only the tile grid (sidebar preview)
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
        {tileLayout.map((descriptor) => {
          const { index, role, label, gridColumn, gridRow } = descriptor;
          const placementStyle: React.CSSProperties | undefined =
            gridColumn || gridRow
              ? { gridColumn: gridColumn, gridRow: gridRow }
              : undefined;

          return (
            <TileWrapper key={index} index={index} style={placementStyle}>
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
                    {tiles[index] && (
                      <img src={tiles[index]} alt="" className="absolute" style={stripStyle} draggable={false} />
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
                  tileSrc={tiles[photoTileIndexMap.get(index) ?? 0] || ''}
                  index={index}
                  totalTiles={gridConfig.size}
                  categoryType={categoryType}
                  floresFilter={floresFilters?.find((f) => f.tileIndex === index)?.filter}
                  textFields={textFields}
                  gridSize={gridConfig.size}
                />
              )}
            </TileWrapper>
          );
        })}

        {categoryType !== 'spotify' && categoryType !== 'arte' && categoryType !== 'polaroid' && categoryType !== 'ghibli' && (
          <MosaikoWatermark />
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

      {/* Fridge surface simulation */}
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
          {/* Subtle fridge texture dots */}
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
                gap: categoryType === 'polaroid' ? '0px' : '4px',
                maxWidth: `${gridConfig.cols * 120}px`,
              }}
            >
              {tileLayout.map((descriptor) => {
                const { index, role, label, gridColumn, gridRow } = descriptor;
                const placementStyle: React.CSSProperties | undefined =
                  gridColumn || gridRow
                    ? { gridColumn: gridColumn, gridRow: gridRow }
                    : undefined;

                return (
                  <TileWrapper key={index} index={index} style={placementStyle}>
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
                          {tiles[index] && (
                            <img src={tiles[index]} alt="" className="absolute" style={stripStyle} draggable={false} />
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
                        tileSrc={tiles[photoTileIndexMap.get(index) ?? 0] || ''}
                        index={index}
                        totalTiles={gridConfig.size}
                        categoryType={categoryType}
                        floresFilter={floresFilters?.find((f) => f.tileIndex === index)?.filter}
                        textFields={textFields}
                        gridSize={gridConfig.size}
                      />
                    )}
                  </TileWrapper>
                );
              })}

              {/* Mosaiko logo watermark — skip for categories that have their own logo in special tiles */}
              {categoryType !== 'spotify' && categoryType !== 'arte' && categoryType !== 'polaroid' && categoryType !== 'ghibli' && (
                <MosaikoWatermark />
              )}
            </div>
          )}
        </motion.div>
      </div>

      {/* Info section */}
      {!isLoading && !error && (
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: tileLayout.length * 0.05 + 0.2, duration: 0.4 }}
          className="flex flex-col gap-4"
        >
          {/* Product info card */}
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

          {/* Action buttons */}
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
      {/* Magnetic shadow */}
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

/** Determine which Save the Date overlay text to show per tile */
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
  floresFilter,
  textFields,
  gridSize,
}: {
  tileSrc: string;
  index: number;
  totalTiles: number;
  categoryType: CategoryType;
  floresFilter?: string;
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

  // Spotify: photo with PNG template overlay (black frame with rounded corners)
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

  // Polaroid: tile fills full area, frame PNG overlays on top
  if (categoryType === 'polaroid') {
    const tileNumber = index + 1;
    return (
      <div className="relative overflow-hidden" style={{ aspectRatio: '1' }}>
        {imgElement}
        <img
          src={`/templates/polaroid/${tileNumber}.png`}
          alt=""
          className="pointer-events-none absolute inset-0 h-full w-full"
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

  // Ghibli/Studio: photo inside transparent cutout + PNG frame on top (relative for flow height)
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

  // Flores: apply CSS filter (same image on each tile, different filter)
  if (categoryType === 'flores') {
    return (
      <div
        className="overflow-hidden rounded-md"
        style={{
          aspectRatio: '1',
          boxShadow: '0 2px 8px rgba(0,0,0,0.15), 0 1px 3px rgba(0,0,0,0.1)',
          filter: floresFilter || 'none',
        }}
      >
        {imgElement}
      </div>
    );
  }

  // Save the Date: photo + text overlay on correct tiles
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

  // Default: plain photo tile
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
