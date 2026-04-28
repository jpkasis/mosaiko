import { CATEGORY_LAYOUTS } from './category-layouts';

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
// Derived from `CATEGORY_LAYOUTS` so the legacy lookup keys and the canonical
// contract stay in lockstep. PR 1b migrates the remaining consumer (the
// rotatable check in `useBuilderFlow`) to `layout.rotatable` directly and
// this export can be deleted.

export interface CategoryLayoutOverride {
  rows: number;   // total visual rows (CSS grid)
  cols: number;   // total visual cols
  aspect: number; // crop aspect ratio (width / height)
}

function buildOverrides(): Partial<Record<string, CategoryLayoutOverride>> {
  const out: Partial<Record<string, CategoryLayoutOverride>> = {};
  for (const [cat, layout] of Object.entries(CATEGORY_LAYOUTS)) {
    for (const [sizeStr, dim] of Object.entries(layout.dimensions)) {
      if (!dim) continue;
      const size = Number(sizeStr) as GridSize;
      const base = GRID_CONFIGS[size];
      // Fall the aspect back to the base before comparing so a future
      // category that differs only in dimensions (same aspect, custom
      // rows/cols) still surfaces as an override.
      const aspect = layout.cropAspect[size] ?? base.aspect;
      // Preserve the legacy convention: only non-base combinations appear in
      // this map. That keeps the `!!overrides[cat:size]` truthiness check in
      // downstream callers semantically identical.
      if (
        aspect !== base.aspect ||
        dim.rows !== base.rows ||
        dim.cols !== base.cols
      ) {
        out[`${cat}:${size}`] = { rows: dim.rows, cols: dim.cols, aspect };
      }
    }
  }
  return out;
}

export const CATEGORY_LAYOUT_OVERRIDES: Partial<Record<string, CategoryLayoutOverride>> =
  buildOverrides();

/**
 * Returns the effective grid config for a category + grid size combination.
 * Pulls rows / cols / aspect from the canonical `CATEGORY_LAYOUTS` contract;
 * price and label always come from `GRID_CONFIGS` (they describe the
 * physical magnet, not the visual layout).
 */
export function getEffectiveGridConfig(
  gridSize: GridSize,
  categoryType?: string,
): GridConfig {
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
