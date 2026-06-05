'use client';

import { useTranslations } from 'next-intl';
import { motion } from 'framer-motion';
import { GRID_CONFIGS, formatPrice, type GridSize } from '@/lib/grid-config';
import type { CategoryType } from '@/lib/customization-types';
import { usePriceMap, priceFor } from '@/components/pricing/PricesProvider';

interface GridSelectorProps {
  onSelect: (grid: GridSize) => void;
  selected: GridSize | null;
  allowedSizes?: GridSize[];
  /** Category drives the live per-(category, size) price shown on each card. */
  category?: CategoryType | null;
}

// PR-C: 1 (single tile) leads the ladder; categories filter via allowedSizes.
const GRID_OPTIONS: GridSize[] = [1, 3, 4, 6, 9];

/** Visual SVG icon for each grid layout — all tiles are square (like real magnets). */
function GridIcon({ size, isSelected }: { size: GridSize; isSelected: boolean }) {
  const config = GRID_CONFIGS[size];
  const fillColor = isSelected ? '#7b3f1e' : '#422102';
  const gap = 2;
  const cell = 12;
  const vw = config.cols * cell + (config.cols - 1) * gap;
  const vh = config.rows * cell + (config.rows - 1) * gap;
  const maxDim = 48;
  const scale = maxDim / Math.max(vw, vh);
  const displayW = Math.round(vw * scale);
  const displayH = Math.round(vh * scale);

  return (
    <svg
      width={displayW}
      height={displayH}
      viewBox={`0 0 ${vw} ${vh}`}
      aria-hidden="true"
      className="shrink-0"
    >
      {Array.from({ length: config.rows }).map((_, row) =>
        Array.from({ length: config.cols }).map((_, col) => (
          <rect
            key={`${row}-${col}`}
            x={col * (cell + gap)}
            y={row * (cell + gap)}
            width={cell}
            height={cell}
            rx={2}
            fill={fillColor}
            opacity={isSelected ? 0.9 : 0.6}
          />
        )),
      )}
    </svg>
  );
}

const TILE_CM = 7;

function getDimensions(config: { cols: number; rows: number }) {
  const totalW = config.cols * TILE_CM;
  const totalH = config.rows * TILE_CM;
  return { tile: `${TILE_CM}×${TILE_CM}cm`, total: `${totalW}×${totalH}cm` };
}

const containerVariants = {
  hidden: {},
  visible: {
    transition: {
      staggerChildren: 0.08,
    },
  },
};

const cardVariants = {
  hidden: { opacity: 0, y: 20, scale: 0.95 },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { type: 'spring' as const, stiffness: 300, damping: 24 },
  },
};

export function GridSelector({ onSelect, selected, allowedSizes, category }: GridSelectorProps) {
  const t = useTranslations('builder');
  const options = allowedSizes ?? GRID_OPTIONS;
  const priceMap = usePriceMap();

  return (
    <div className="flex flex-col gap-6">
      <div className="text-center">
        <h2 className="font-serif text-2xl font-bold text-charcoal md:text-3xl">
          {t('stepGrid')}
        </h2>
        <p className="mt-2 text-sm text-warm-gray md:text-base">
          {t('subtitle')}
        </p>
      </div>

      <motion.div
        variants={containerVariants}
        initial="hidden"
        animate="visible"
        className="grid grid-cols-2 gap-3 md:gap-4"
      >
        {options.map((size) => {
          const config = GRID_CONFIGS[size];
          const isSelected = selected === size;
          const label = config.label as 'grid1' | 'grid3' | 'grid4' | 'grid6' | 'grid9';
          const descKey = `${label}Desc` as
            | 'grid1Desc'
            | 'grid3Desc'
            | 'grid4Desc'
            | 'grid6Desc'
            | 'grid9Desc';

          return (
            <motion.button
              key={size}
              variants={cardVariants}
              whileTap={{ scale: 0.97 }}
              onClick={() => onSelect(size)}
              aria-pressed={isSelected}
              className={[
                'group relative flex flex-col items-center gap-3 rounded-xl p-4 md:p-5',
                'transition-all duration-200 cursor-pointer',
                'border-2 bg-white',
                'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-terracotta',
                isSelected
                  ? 'border-terracotta shadow-[0_0_0_1px_var(--terracotta),0_4px_20px_rgba(123,63,30,0.15)]'
                  : 'border-light-gray hover:border-terracotta-light hover:shadow-md',
              ].join(' ')}
            >
              {/* Selection indicator */}
              {isSelected && (
                <motion.div
                  layoutId="grid-selection-indicator"
                  className="absolute -right-1.5 -top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-terracotta text-white"
                  initial={false}
                  transition={{ type: 'spring', stiffness: 400, damping: 25 }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </motion.div>
              )}

              <GridIcon size={size} isSelected={isSelected} />

              <div className="flex flex-col items-center gap-1">
                <span className="text-sm font-semibold text-charcoal md:text-base">
                  {t(label)}
                </span>
                <span className="text-xs text-warm-gray leading-snug text-center">
                  {t(descKey)}
                </span>
                <span className="mt-0.5 text-[10px] text-warm-gray/70 leading-tight text-center">
                  {getDimensions(config).tile} c/u · {getDimensions(config).total} total
                </span>
              </div>

              <span
                className={[
                  'mt-auto rounded-full px-3 py-1 text-sm font-bold',
                  isSelected
                    ? 'bg-terracotta text-white'
                    : 'bg-cream text-charcoal',
                ].join(' ')}
              >
                {formatPrice(priceFor(priceMap, category, size))}
              </span>
            </motion.button>
          );
        })}
      </motion.div>
    </div>
  );
}
