/**
 * PR-B — Shopify is the single source of truth for prices.
 *
 * Reads the live `(category, gridSize) → { price, variantId }` matrix from
 * the v2 pricing product (`imanes-personalizados-v2`) via the Storefront
 * API, cached (short TTL + `revalidateTag`, mirroring the CMS pattern in
 * `site-content.ts`). Every place that DISPLAYS a price and the checkout
 * that CHARGES it both read this one matrix, so displayed === charged.
 *
 * Graceful degradation: pre-publish (product not live yet) or on a Shopify
 * outage, DISPLAY falls back to the legacy SIZE-BASED grid-config price (so
 * it matches what the legacy size-only variant actually charges — no drift
 * window). CHECKOUT (`getPricingForCheckout`) is stricter: it falls back to
 * the legacy variant ONLY when it positively confirmed the product isn't
 * published yet, and fails closed on a real read error. (`SEED_PRICE_MATRIX`
 * — the per-category TARGET prices — is used only by the migration that
 * creates the v2 variants, NOT as the display fallback.)
 */
import 'server-only';
import { unstable_cache } from 'next/cache';
import { shopifyFetch } from './client';
import type { CategoryType } from '../customization-types';
import type { GridSize } from '../grid-config';
import { GRID_CONFIGS } from '../grid-config';
import {
  PRICING_PRODUCT_HANDLE,
  CATEGORY_OPTION_NAME,
  SIZE_OPTION_NAME,
  categoryFromOptionValue,
  sizeFromOptionValue,
  PRICING_COMBOS,
} from './pricing-options';

/** Cache tag the admin price-save busts via `revalidateTag(PRICE_MATRIX_TAG)`. */
export const PRICE_MATRIX_TAG = 'shopify:price-matrix';
const PRICE_MATRIX_REVALIDATE_S = 60; // short TTL; admin save bypasses via tag

export interface PriceCell {
  /** MXN amount (may be fractional). */
  price: number;
  /** v2 variant GID; `null` when the cell came from the seed fallback. */
  variantId: string | null;
  availableForSale: boolean;
  source: 'shopify' | 'seed';
}

export type PriceMatrix = Partial<
  Record<CategoryType, Partial<Record<GridSize, PriceCell>>>
>;

/**
 * Thrown when the v2 pricing product isn't published to the Storefront yet
 * (pre-migration / pre-publish). DISTINCT from a Shopify outage: this is the
 * normal "not cut over yet" state → legacy size-based prices are correct.
 * `unstable_cache` does not cache thrown values, so this is never cached —
 * the moment the product is published the storefront/checkout pick it up
 * (no stale empty-matrix window). A real Storefront error throws a generic
 * Error instead, which the checkout treats as fail-closed.
 */
export class PricingProductNotLiveError extends Error {
  constructor() {
    super('Pricing product not published to the storefront yet');
    this.name = 'PricingProductNotLiveError';
  }
}

interface StorefrontVariant {
  id: string;
  availableForSale: boolean;
  price: { amount: string };
  selectedOptions: { name: string; value: string }[];
}

const PRICE_QUERY = /* GraphQL */ `
  query PriceMatrix($handle: String!) {
    productByHandle(handle: $handle) {
      id
      variants(first: 100) {
        edges {
          node {
            id
            availableForSale
            price { amount }
            selectedOptions { name value }
          }
        }
      }
    }
  }
`;

function cellFor(variant: StorefrontVariant): {
  category: CategoryType;
  gridSize: GridSize;
  cell: PriceCell;
} | null {
  let category: CategoryType | null = null;
  let gridSize: GridSize | null = null;
  for (const opt of variant.selectedOptions) {
    if (opt.name === CATEGORY_OPTION_NAME) category = categoryFromOptionValue(opt.value);
    else if (opt.name === SIZE_OPTION_NAME) gridSize = sizeFromOptionValue(opt.value);
  }
  if (!category || gridSize == null) return null;
  const price = Number.parseFloat(variant.price.amount);
  if (!Number.isFinite(price)) return null;
  return {
    category,
    gridSize,
    cell: { price, variantId: variant.id, availableForSale: variant.availableForSale, source: 'shopify' },
  };
}

/** Live matrix from Shopify. Returns `{}` when the product doesn't exist. */
async function fetchShopifyMatrix(): Promise<PriceMatrix> {
  const data = await shopifyFetch<{
    productByHandle: { variants: { edges: { node: StorefrontVariant }[] } } | null;
  }>({ query: PRICE_QUERY, variables: { handle: PRICING_PRODUCT_HANDLE } });

  const product = data?.productByHandle;
  // Not published yet → throw (NOT cached, so publish cuts over immediately).
  if (!product) throw new PricingProductNotLiveError();

  const matrix: PriceMatrix = {};
  for (const { node } of product.variants.edges) {
    const parsed = cellFor(node);
    if (!parsed) continue;
    (matrix[parsed.category] ??= {})[parsed.gridSize] = parsed.cell;
  }
  return matrix;
}

const fetchShopifyMatrixCached = unstable_cache(fetchShopifyMatrix, ['shopify-price-matrix'], {
  tags: [PRICE_MATRIX_TAG],
  revalidate: PRICE_MATRIX_REVALIDATE_S,
});

/**
 * Fallback when the v2 product is absent (pre-migration) or Shopify is
 * unreachable. Uses the LEGACY size-based grid-config price for every valid
 * (category, size) so the DISPLAYED price matches what the legacy size-only
 * variant actually CHARGES — i.e. no drift window before the cutover. (The
 * per-category target prices live in `SEED_PRICE_MATRIX` and are used only by
 * the migration that creates the v2 variants.)
 */
function seedMatrix(): PriceMatrix {
  const matrix: PriceMatrix = {};
  for (const { category, gridSize } of PRICING_COMBOS) {
    const price = GRID_CONFIGS[gridSize]?.price;
    if (price == null) continue;
    (matrix[category] ??= {})[gridSize] = {
      price,
      variantId: null,
      availableForSale: true,
      source: 'seed',
    };
  }
  return matrix;
}

/**
 * DISPLAY path — tolerant. Live Shopify prices when the v2 product is
 * published; otherwise the legacy size-based seed (pre-publish OR a Shopify
 * outage both fall back so a price is always shown). `unstable_cache` does
 * not cache throws, so the not-live state is never cached → publishing the
 * product cuts the storefront over immediately (no stale empty-matrix window).
 */
export async function getPriceMatrix(): Promise<PriceMatrix> {
  try {
    return await fetchShopifyMatrixCached();
  } catch {
    return seedMatrix();
  }
}

/**
 * CHECKOUT path — STRICT, so we never silently charge the wrong price.
 * Returns `{ migrated, matrix }`:
 *   - migrated:true  → the v2 product is live; charge its per-(category,size)
 *     variant and FAIL CLOSED if a needed combo is missing/unavailable.
 *   - migrated:false → positively confirmed the product isn't published yet
 *     (PricingProductNotLiveError) → the legacy size-only variant is correct.
 * A real Shopify read error PROPAGATES (the caller returns a blocking error)
 * rather than guessing a price.
 */
export async function getPricingForCheckout(): Promise<{
  migrated: boolean;
  matrix: PriceMatrix;
}> {
  try {
    return { migrated: true, matrix: await fetchShopifyMatrixCached() };
  } catch (e) {
    if (e instanceof PricingProductNotLiveError) return { migrated: false, matrix: seedMatrix() };
    throw e;
  }
}

/** Plain `(category, size) → price` map, serializable for client props/context. */
export type DisplayPriceMap = Partial<Record<CategoryType, Partial<Record<GridSize, number>>>>;

/**
 * The price matrix flattened to plain numbers — passed to the client-side
 * `PricesProvider` so the storefront (catalog cards, builder grid selector,
 * add-to-cart) shows the same price the checkout charges.
 */
export async function getDisplayPriceMap(): Promise<DisplayPriceMap> {
  const matrix = await getPriceMatrix();
  const out: DisplayPriceMap = {};
  for (const category of Object.keys(matrix) as CategoryType[]) {
    const sizes = matrix[category];
    if (!sizes) continue;
    for (const sizeStr of Object.keys(sizes)) {
      const gridSize = Number(sizeStr) as GridSize;
      const price = sizes[gridSize]?.price;
      if (price != null) (out[category] ??= {})[gridSize] = price;
    }
  }
  return out;
}

/** Display price for a (category, size), or `null` if undefined. */
export async function getPrice(
  category: CategoryType,
  gridSize: GridSize,
): Promise<number | null> {
  const matrix = await getPriceMatrix();
  return matrix[category]?.[gridSize]?.price ?? null;
}

/**
 * The v2 variant GID to charge for (category, size). `null` when the matrix
 * is the seed fallback (pre-migration) — the caller then uses the legacy
 * size-only variant map so checkout never breaks before the cutover.
 */
export async function resolvePricedVariantId(
  category: CategoryType,
  gridSize: GridSize,
): Promise<string | null> {
  const matrix = await getPriceMatrix();
  const cell = matrix[category]?.[gridSize];
  return cell?.variantId && cell.availableForSale ? cell.variantId : null;
}

/**
 * The cheapest "standard" (non-single-tile, gridSize > 1) price across all
 * categories — drives PR-C's minimum-order gate so it tracks live edits.
 */
export async function getCheapestStandardPrice(): Promise<number | null> {
  const matrix = await getPriceMatrix();
  let min: number | null = null;
  for (const sizes of Object.values(matrix)) {
    if (!sizes) continue;
    for (const sizeStr of Object.keys(sizes)) {
      if (Number(sizeStr) <= 1) continue; // exclude single tile
      const price = sizes[Number(sizeStr) as GridSize]?.price;
      if (price != null && (min == null || price < min)) min = price;
    }
  }
  return min;
}
