'use client';

import { useTranslations } from 'next-intl';
import { motion } from 'framer-motion';
import { CATEGORY_REGISTRY, type CategoryType } from '@/lib/customization-types';
import { GRID_CONFIGS, CATEGORY_LAYOUT_OVERRIDES, formatPrice, type GridSize } from '@/lib/grid-config';

interface CategorySelectorProps {
  onSelect: (category: CategoryType) => void;
  selected: CategoryType | null;
}

const CATEGORY_ORDER: CategoryType[] = [
  'mosaicos',
  'spotify',
  'polaroid',
  'arte',
  'ghibli',
  'save-the-date',
  'tonos',
];

const I18N_KEY_MAP: Record<CategoryType, { name: string; desc: string }> = {
  mosaicos: { name: 'categoryMosaicos', desc: 'categoryMosaicosDesc' },
  spotify: { name: 'categorySpotify', desc: 'categorySpotifyDesc' },
  polaroid: { name: 'categoryPolaroid', desc: 'categoryPolaroidDesc' },
  arte: { name: 'categoryArte', desc: 'categoryArteDesc' },
  ghibli: { name: 'categoryGhibli', desc: 'categoryGhibliDesc' },
  'save-the-date': { name: 'categorySaveTheDate', desc: 'categorySaveTheDateDesc' },
  tonos: { name: 'categoryTonos', desc: 'categoryTonosDesc' },
};

/** SVG icons representing each category's visual style */
function CategoryIcon({ category, isSelected }: { category: CategoryType; isSelected: boolean }) {
  const fill = isSelected ? '#7b3f1e' : '#422102';
  const accent = isSelected ? '#8b5533' : '#5a3010';

  switch (category) {
    case 'mosaicos':
      return (
        <svg width="40" height="40" viewBox="0 0 40 40" fill="none" aria-hidden="true">
          <rect x="2" y="2" width="11" height="11" rx="2" fill={fill} opacity={0.9} />
          <rect x="15" y="2" width="11" height="11" rx="2" fill={fill} opacity={0.7} />
          <rect x="28" y="2" width="11" height="11" rx="2" fill={fill} opacity={0.9} />
          <rect x="2" y="15" width="11" height="11" rx="2" fill={fill} opacity={0.7} />
          <rect x="15" y="15" width="11" height="11" rx="2" fill={fill} opacity={0.9} />
          <rect x="28" y="15" width="11" height="11" rx="2" fill={fill} opacity={0.7} />
          <rect x="2" y="28" width="11" height="11" rx="2" fill={fill} opacity={0.9} />
          <rect x="15" y="28" width="11" height="11" rx="2" fill={fill} opacity={0.7} />
          <rect x="28" y="28" width="11" height="11" rx="2" fill={fill} opacity={0.9} />
        </svg>
      );
    case 'spotify':
      return (
        <svg width="40" height="40" viewBox="0 0 40 40" fill="none" aria-hidden="true">
          <rect x="2" y="2" width="17" height="17" rx="2" fill={fill} opacity={0.7} />
          <rect x="21" y="2" width="17" height="17" rx="2" fill={fill} opacity={0.7} />
          <rect x="2" y="21" width="36" height="17" rx="2" fill="#191414" />
          <circle cx="14" cy="29.5" r="6" fill="#1DB954" />
          <polygon points="12,26.5 12,32.5 17,29.5" fill="#191414" />
          <rect x="24" y="26" width="2" height="7" rx="1" fill="#1DB954" opacity={0.8} />
          <rect x="28" y="24" width="2" height="11" rx="1" fill="#1DB954" opacity={0.6} />
          <rect x="32" y="27" width="2" height="5" rx="1" fill="#535353" opacity={0.5} />
        </svg>
      );
    case 'polaroid':
      return (
        <svg width="40" height="40" viewBox="0 0 40 40" fill="none" aria-hidden="true">
          <rect x="2" y="2" width="17" height="17" rx="1" fill="white" stroke={fill} strokeWidth="1.5" />
          <rect x="5" y="4" width="11" height="9" rx="1" fill={fill} opacity={0.6} />
          <rect x="21" y="2" width="17" height="17" rx="1" fill="white" stroke={fill} strokeWidth="1.5" />
          <rect x="24" y="4" width="11" height="9" rx="1" fill={fill} opacity={0.6} />
          <rect x="2" y="21" width="17" height="17" rx="1" fill="white" stroke={fill} strokeWidth="1.5" />
          <rect x="5" y="23" width="11" height="9" rx="1" fill={fill} opacity={0.6} />
          <rect x="21" y="21" width="17" height="17" rx="1" fill="white" stroke={fill} strokeWidth="1.5" />
          <rect x="24" y="23" width="11" height="9" rx="1" fill={fill} opacity={0.6} />
        </svg>
      );
    case 'arte':
      return (
        <svg width="40" height="40" viewBox="0 0 40 40" fill="none" aria-hidden="true">
          <rect x="2" y="2" width="25" height="36" rx="2" fill={fill} opacity={0.6} />
          <rect x="29" y="2" width="9" height="25" rx="2" fill={fill} opacity={0.4} />
          <rect x="29" y="29" width="9" height="9" rx="2" fill="#191414" />
          <line x1="31" y1="33" x2="36" y2="33" stroke="white" strokeWidth="1" opacity={0.8} />
          <line x1="31" y1="35.5" x2="35" y2="35.5" stroke="#999" strokeWidth="0.8" opacity={0.6} />
        </svg>
      );
    case 'ghibli':
      return (
        <svg width="40" height="40" viewBox="0 0 40 40" fill="none" aria-hidden="true">
          <rect x="2" y="2" width="17" height="17" rx="2" fill={fill} opacity={0.7} />
          <rect x="21" y="2" width="17" height="17" rx="2" fill={fill} opacity={0.7} />
          <rect x="2" y="21" width="17" height="17" rx="2" fill="#1a1a2e" />
          <text x="10.5" y="32" textAnchor="middle" fill="#f5e6d3" fontSize="9" fontFamily="serif">2001</text>
          <rect x="21" y="21" width="17" height="17" rx="2" fill="#1a1a2e" />
          <text x="29.5" y="31" textAnchor="middle" fill="#d4a373" fontSize="7" fontFamily="serif" opacity={0.9}>
            <tspan x="29.5" dy="0">&#x2605;</tspan>
          </text>
        </svg>
      );
    case 'save-the-date':
      return (
        <svg width="40" height="40" viewBox="0 0 40 40" fill="none" aria-hidden="true">
          <rect x="2" y="2" width="36" height="36" rx="2" fill={fill} opacity={0.5} />
          <rect x="2" y="2" width="36" height="36" rx="2" fill="black" opacity={0.3} />
          <text x="20" y="18" textAnchor="middle" fill="white" fontSize="7" fontFamily="sans-serif" fontWeight="bold">SAVE THE</text>
          <text x="20" y="27" textAnchor="middle" fill={accent} fontSize="8" fontFamily="serif" fontWeight="bold">DATE</text>
          <line x1="10" y1="31" x2="30" y2="31" stroke="white" strokeWidth="0.5" opacity={0.5} />
          <text x="20" y="36" textAnchor="middle" fill="white" fontSize="5" fontFamily="sans-serif" opacity={0.7}>15.06.2026</text>
        </svg>
      );
    case 'tonos':
      return (
        <svg width="40" height="40" viewBox="0 0 40 40" fill="none" aria-hidden="true">
          <rect x="2" y="2" width="11" height="11" rx="2" fill={fill} opacity={0.5} />
          <rect x="15" y="2" width="11" height="11" rx="2" fill={accent} opacity={0.6} />
          <rect x="28" y="2" width="11" height="11" rx="2" fill={fill} opacity={0.7} />
          <rect x="2" y="15" width="11" height="11" rx="2" fill={accent} opacity={0.5} />
          <rect x="15" y="15" width="11" height="11" rx="2" fill={fill} opacity={0.9} />
          <rect x="28" y="15" width="11" height="11" rx="2" fill={accent} opacity={0.5} />
          <rect x="2" y="28" width="11" height="11" rx="2" fill={fill} opacity={0.7} />
          <rect x="15" y="28" width="11" height="11" rx="2" fill={accent} opacity={0.6} />
          <rect x="28" y="28" width="11" height="11" rx="2" fill={fill} opacity={0.5} />
        </svg>
      );
  }
}

const containerVariants = {
  hidden: {},
  visible: {
    transition: {
      staggerChildren: 0.06,
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

function getGridBadge(allowedGridSizes: GridSize[], categoryType?: CategoryType): { rows: number; cols: number; count: number; customLabel?: string } {
  const defaultSize = allowedGridSizes[0];
  const config = GRID_CONFIGS[defaultSize];

  // Check for category-specific layout override
  if (categoryType) {
    const override = CATEGORY_LAYOUT_OVERRIDES[`${categoryType}:${defaultSize}`];
    if (override) {
      return { rows: override.rows, cols: override.cols, count: config.size, customLabel: '4×2+1 · 9' };
    }
  }

  return { rows: config.rows, cols: config.cols, count: config.size };
}

function getCategoryPrice(allowedGridSizes: GridSize[]): string {
  // Show price range: "Desde $200" or single price
  const prices = allowedGridSizes.map((s) => GRID_CONFIGS[s].price);
  const min = Math.min(...prices);
  if (prices.length === 1) return formatPrice(min);
  return `Desde ${formatPrice(min)}`;
}

export function CategorySelector({ onSelect, selected }: CategorySelectorProps) {
  const t = useTranslations('builder');

  return (
    <div className="flex flex-col gap-6">
      <div className="text-center">
        <h2 className="font-serif text-2xl font-bold text-charcoal md:text-3xl">
          {t('stepCategory')}
        </h2>
        <p className="mt-2 text-sm text-warm-gray md:text-base">
          {t('selectCategory')}
        </p>
      </div>

      <motion.div
        variants={containerVariants}
        initial="hidden"
        animate="visible"
        className="grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-4"
      >
        {CATEGORY_ORDER.map((cat) => {
          const meta = CATEGORY_REGISTRY[cat];
          const isSelected = selected === cat;
          const keys = I18N_KEY_MAP[cat];
          const badge = getGridBadge(meta.allowedGridSizes, cat);

          return (
            <motion.button
              key={cat}
              variants={cardVariants}
              whileTap={{ scale: 0.97 }}
              onClick={() => onSelect(cat)}
              aria-pressed={isSelected}
              className={[
                'group relative flex flex-col items-center gap-2.5 rounded-xl p-4 md:p-5',
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
                  layoutId="category-selection-indicator"
                  className="absolute -right-1.5 -top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-terracotta text-white"
                  initial={false}
                  transition={{ type: 'spring', stiffness: 400, damping: 25 }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </motion.div>
              )}

              <CategoryIcon category={cat} isSelected={isSelected} />

              <div className="flex flex-col items-center gap-1">
                <span className="text-sm font-semibold text-charcoal md:text-base">
                  {t(keys.name)}
                </span>
                <span className="text-xs leading-snug text-warm-gray text-center">
                  {t(keys.desc)}
                </span>
                <span className="mt-0.5 text-[10px] text-warm-gray/70 leading-tight">
                  {badge.customLabel
                    ? badge.customLabel
                    : t('categoryGridBadge', { cols: badge.cols, rows: badge.rows, count: badge.count })}
                </span>
              </div>

              <span
                className={[
                  'mt-auto rounded-full px-3 py-1 text-xs font-bold',
                  isSelected
                    ? 'bg-terracotta text-white'
                    : 'bg-cream text-charcoal',
                ].join(' ')}
              >
                {getCategoryPrice(meta.allowedGridSizes)}
              </span>
            </motion.button>
          );
        })}
      </motion.div>
    </div>
  );
}
