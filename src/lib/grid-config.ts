export type GridSize = 3 | 4 | 6 | 9;

export interface GridConfig {
  size: GridSize;
  rows: number;
  cols: number;
  aspect: number; // width / height
  price: number; // MXN
  label: string; // i18n key suffix
}

export const GRID_CONFIGS: Record<GridSize, GridConfig> = {
  3: {
    size: 3,
    rows: 1,
    cols: 3,
    aspect: 3 / 1,
    price: 200,
    label: 'grid3',
  },
  4: {
    size: 4,
    rows: 2,
    cols: 2,
    aspect: 1 / 1,
    price: 280,
    label: 'grid4',
  },
  6: {
    size: 6,
    rows: 3,
    cols: 2,
    aspect: 2 / 3,
    price: 360,
    label: 'grid6',
  },
  9: {
    size: 9,
    rows: 3,
    cols: 3,
    aspect: 1 / 1,
    price: 480,
    label: 'grid9',
  },
};

export const TILE_PRINT_SIZE = 827; // 7cm at 300dpi

// ─── Per-category layout overrides ──────────────────────────────────────────
// gridSize determines pricing. The visual/print layout varies per category.

export interface CategoryLayoutOverride {
  rows: number;   // total visual rows (CSS grid)
  cols: number;   // total visual cols
  aspect: number; // crop aspect ratio (width / height)
}

export const CATEGORY_LAYOUT_OVERRIDES: Partial<Record<string, CategoryLayoutOverride>> = {
  'arte:9': { rows: 3, cols: 4, aspect: 4 / 2 },
  'spotify:6': { rows: 3, cols: 2, aspect: 1 },   // photo area is 2×2 (top 4 tiles)
  'ghibli:6': { rows: 3, cols: 2, aspect: 1055 / 1204 }, // matches photo buffer (colLeftW+colRightW) / (rowTopH+rowBotH+stripH)
  'polaroid:4': { rows: 2, cols: 2, aspect: 180 / 160 }, // crop matches visible photo opening inside Polaroid frame
};

/**
 * Returns the effective grid config for a category + grid size combination.
 * Merges any layout override into the base config, preserving price.
 */
export function getEffectiveGridConfig(gridSize: GridSize, categoryType?: string): GridConfig {
  const base = GRID_CONFIGS[gridSize];
  if (!categoryType) return base;
  const override = CATEGORY_LAYOUT_OVERRIDES[`${categoryType}:${gridSize}`];
  if (!override) return base;
  return { ...base, rows: override.rows, cols: override.cols, aspect: override.aspect };
}

export function formatPrice(price: number): string {
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: 'MXN',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(price);
}
