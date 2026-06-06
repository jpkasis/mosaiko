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
 * window). CHECKOUT (`getPricingForCheckout`) is STRICT: v2 is the single
 * source of truth, so it returns the live matrix or THROWS — for a not-yet-
 * published product OR a real Shopify error alike — and the caller fails
 * closed (PRICING_UNAVAILABLE, no cart created), never charging a legacy/seed
 * price. (`SEED_PRICE_MATRIX` — the per-category TARGET prices — is used only
 * by the migration that creates the v2 variants, NOT as the display fallback.)
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
    product(handle: $handle) {
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

/**
 * Live matrix from Shopify. Throws `PricingProductNotLiveError` when the product
 * isn't published. `noStore: true` bypasses Next's fetch data cache — used by
 * the STRICT checkout read so it always observes the TRUE current state of v2,
 * never a stale-but-warm matrix (see `getPricingForCheckout`).
 */
async function fetchShopifyMatrix(opts?: { noStore?: boolean }): Promise<PriceMatrix> {
  const data = await shopifyFetch<{
    product: { variants: { edges: { node: StorefrontVariant }[] } } | null;
  }>({
    query: PRICE_QUERY,
    variables: { handle: PRICING_PRODUCT_HANDLE },
    options: opts?.noStore ? { cache: 'no-store' } : undefined,
  });

  const product = data?.product;
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

// DISPLAY path: 60s `unstable_cache` over the default (data-cached) read.
const fetchShopifyMatrixCached = unstable_cache(() => fetchShopifyMatrix(), ['shopify-price-matrix'], {
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
    // The seed is the LEGACY-world fallback (used pre-publish or during a v2
    // outage). The single tile (gridSize 1) is a v2-only product — the legacy
    // size-only variants have no 1-piece — so omit it here, otherwise the UI
    // would offer a $67 tile that can't check out (Codex full audit).
    if (gridSize === 1) continue;
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
 * CHECKOUT path — STRICT + UNCACHED, so we never silently charge the wrong
 * price (Phase 7 money-path BLOCKER, Codex pre-flight + final audit). v2 is the
 * SINGLE SOURCE OF TRUTH: this does a fresh `cache: 'no-store'` Storefront read
 * (bypassing BOTH the 60s display cache AND Next's fetch data cache) and returns
 * the live `{ matrix }` or THROWS. ANY failure to read v2 —
 * `PricingProductNotLiveError` (not published) OR a real Shopify error (outage)
 * — propagates, so the caller (`buildCartLines`) returns PRICING_UNAVAILABLE and
 * creates NO cart.
 *
 * The uncached read matters: a warm 60s cache must NOT let checkout proceed on a
 * stale matrix after v2 becomes unreadable (e.g. the Phase 8 Online-Store-
 * unpublish) — that would punch a 60s hole in the fail-closed guarantee.
 * Checkout is low-frequency + high-stakes, so the per-checkout read is fine.
 *
 * There is NO legacy/seed fallback: before this fix, a not-published read fell
 * back to the legacy `SHOPIFY_VARIANT_MAP` price, which would silently mis-charge
 * and mask a bad cutover. Charge the per-(category,size) variant in the returned
 * matrix and fail closed if a needed combo is missing/unavailable.
 */
export async function getPricingForCheckout(): Promise<{ matrix: PriceMatrix }> {
  return { matrix: await fetchShopifyMatrix({ noStore: true }) };
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
