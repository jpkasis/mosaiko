/**
 * Canonical mapping between Mosaiko's (categoryType, gridSize) price keys
 * and the Shopify v2 product's variant OPTION VALUES — plus the seed price
 * matrix. This is the SINGLE SOURCE shared by:
 *   - the one-time migration (`scripts/migrate-pricing.mts`) which CREATES
 *     the v2 product's variants with these option values + seed prices, and
 *   - the live price reader (`prices.ts`) which PARSES each variant's
 *     `selectedOptions` back into a `(category, size) → price` matrix.
 *
 * Architecture (PR-B): Shopify is the single source of truth for prices.
 * One product (`imanes-personalizados-v2`) carries two options —
 * "Categoría" × "Tamaño" — and one variant per valid (category, size) pair,
 * each independently priced. This is what makes per-category pricing
 * (Studio 6-piece = $480 vs basic Mosaico 6-piece = $360) charge correctly
 * instead of the legacy size-only variant that mis-charged everything at the
 * tile-count price.
 */
import type { CategoryType } from '../customization-types';
import { CATEGORY_REGISTRY } from '../customization-types';
import { GRID_CONFIGS, type GridSize } from '../grid-config';

/** Handle of the v2 pricing product. Env-overridable for staging/tests. */
export const PRICING_PRODUCT_HANDLE =
  process.env.SHOPIFY_PRICING_PRODUCT_HANDLE || 'imanes-personalizados-v2';

/** Shopify product option NAMES (must match what the migration creates). */
export const CATEGORY_OPTION_NAME = 'Categoría';
export const SIZE_OPTION_NAME = 'Tamaño';

/**
 * "Categoría" option value for a category == its registry label
 * (e.g. mosaicos → "Mosaicos", save-the-date → "Save the Date"). Using the
 * existing label keeps one source and reads naturally in Shopify admin.
 */
export function categoryOptionValue(category: CategoryType): string {
  return CATEGORY_REGISTRY[category].label;
}

const LABEL_TO_CATEGORY: Record<string, CategoryType> = Object.fromEntries(
  (Object.keys(CATEGORY_REGISTRY) as CategoryType[]).map((c) => [
    CATEGORY_REGISTRY[c].label,
    c,
  ]),
);

export function categoryFromOptionValue(value: string): CategoryType | null {
  return LABEL_TO_CATEGORY[value.trim()] ?? null;
}

/**
 * "Tamaño" option value, e.g. 6 → "6 piezas", 1 → "1 pieza". Typed as
 * `number` (not `GridSize`) so the singular branch is valid before PR-C
 * widens `GridSize` to include 1; every caller passes a `GridSize`.
 */
export function sizeOptionValue(size: number): string {
  return `${size} ${size === 1 ? 'pieza' : 'piezas'}`;
}

export function sizeFromOptionValue(value: string): GridSize | null {
  const n = parseInt(value.trim(), 10);
  return n === 1 || n === 3 || n === 4 || n === 6 || n === 9 ? (n as GridSize) : null;
}

/**
 * Every valid (category, gridSize) price point, derived from each
 * category's `allowedGridSizes` — so the set stays correct automatically
 * (e.g. when PR-C adds gridSize 1 to mosaicos, that combo appears here).
 */
export interface PriceCombo {
  category: CategoryType;
  gridSize: GridSize;
}

export const PRICING_COMBOS: PriceCombo[] = (
  Object.keys(CATEGORY_REGISTRY) as CategoryType[]
).flatMap((category) =>
  CATEGORY_REGISTRY[category].allowedGridSizes.map((gridSize) => ({
    category,
    gridSize: gridSize as GridSize,
  })),
);

/**
 * Seed prices (MXN, whole pesos) used by the migration to create the v2
 * variants and by `prices.ts` as a graceful fallback when Shopify is
 * unreachable or pre-migration. These mirror the current catalog intent:
 * premium categories (Studio/Spotify/Arte/Tonos/Polaroid) and the
 * tile-count tiers for the basic ones. After migration, the live Shopify
 * variant price is authoritative; this is only a bootstrap/fallback.
 */
export const SEED_PRICE_MATRIX: Record<
  CategoryType,
  Partial<Record<GridSize, number>>
> = {
  // PR-C: 1 (single tile) DEFAULTS to GRID_CONFIGS[1].price = ⌈200/3⌉ = 67 (the
  // seed / migration default); the client edits it freely afterwards like any
  // other price — it is NOT kept in sync with the 3-piece.
  mosaicos: { 1: GRID_CONFIGS[1].price, 3: 200, 6: 360, 9: 480 },
  studio: { 6: 480 },
  arte: { 9: 480 },
  'save-the-date': { 3: 200, 6: 360, 9: 480 },
  tonos: { 3: 200, 9: 480 },
  spotify: { 6: 480 },
  polaroid: { 4: 480 },
};

/** Seed price for a combo, or null if undefined. */
export function seedPrice(category: CategoryType, gridSize: GridSize): number | null {
  return SEED_PRICE_MATRIX[category]?.[gridSize] ?? null;
}
