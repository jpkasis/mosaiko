/**
 * Shared test helper (NOT a test file — no `.test.` so vitest skips it).
 *
 * A full v2 checkout price matrix covering every valid (category, gridSize)
 * combo with a dummy priced + available variant. Use in `buildCartLines` tests
 * that assert NON-pricing behavior (attribute serialization, predesigned
 * guards) and only need pricing to RESOLVE: Phase 7 removed the legacy
 * `SHOPIFY_VARIANT_MAP` fallback, so an empty matrix now fails closed
 * (VARIANT_NOT_FOUND) instead of charging a legacy variant.
 */
import { PRICING_COMBOS, SEED_PRICE_MATRIX } from '@/lib/shopify/pricing-options';
import type { PriceMatrix } from '@/lib/shopify/prices';

export function fullCheckoutMatrix(): PriceMatrix {
  const matrix: PriceMatrix = {};
  for (const { category, gridSize } of PRICING_COMBOS) {
    const price = SEED_PRICE_MATRIX[category]?.[gridSize] ?? 100;
    (matrix[category] ??= {})[gridSize] = {
      price,
      variantId: `gid://shopify/ProductVariant/test-${category}-${gridSize}`,
      availableForSale: true,
      source: 'shopify',
    };
  }
  return matrix;
}
