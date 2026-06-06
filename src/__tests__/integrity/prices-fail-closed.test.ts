/**
 * Phase 7 money-path BLOCKER (Codex pre-flight): CHECKOUT must FAIL CLOSED when
 * the v2 pricing product (`imanes-personalizados-v2`) isn't readable.
 *
 * Before this fix, `getPricingForCheckout()` caught `PricingProductNotLiveError`
 * and returned a legacy SEED matrix (`{ migrated:false, matrix: seedMatrix() }`),
 * and `buildCartLines` then charged the legacy size-only `SHOPIFY_VARIANT_MAP`
 * price. v2 is now the SINGLE SOURCE OF TRUTH, so that fallback is obsolete AND
 * dangerous: at the Phase 8 Online-Store-unpublish, a token that can't see v2
 * would silently charge legacy prices instead of failing — masking the breakage.
 *
 * After the fix: ANY failure to read v2 (not published OR a Shopify outage)
 * propagates, so the caller (`buildCartLines`) returns PRICING_UNAVAILABLE and
 * no cart is created. We never guess/charge a fallback price.
 */
import { describe, test, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));
// Pass-through cache so we exercise the real fetch → error mapping (and never
// cache a thrown not-live state).
vi.mock('next/cache', () => ({
  unstable_cache: (fn: unknown) => fn,
  revalidateTag: vi.fn(),
}));
const mockShopifyFetch = vi.fn();
vi.mock('@/lib/shopify/client', () => ({
  shopifyFetch: (...a: unknown[]) => mockShopifyFetch(...a),
}));

beforeEach(() => {
  mockShopifyFetch.mockReset();
});

describe('getPricingForCheckout — fails closed (no legacy fallback)', () => {
  test('v2 product NOT published → REJECTS (no seed/legacy matrix)', async () => {
    const { getPricingForCheckout, PricingProductNotLiveError } = await import(
      '@/lib/shopify/prices'
    );
    mockShopifyFetch.mockResolvedValue({ product: null }); // not live
    await expect(getPricingForCheckout()).rejects.toBeInstanceOf(
      PricingProductNotLiveError,
    );
  });

  test('Shopify read error → REJECTS (never guesses a price)', async () => {
    const { getPricingForCheckout } = await import('@/lib/shopify/prices');
    mockShopifyFetch.mockRejectedValue(new Error('network'));
    await expect(getPricingForCheckout()).rejects.toBeTruthy();
  });

  test('v2 live → returns the matrix with the v2 variant to charge', async () => {
    const { getPricingForCheckout } = await import('@/lib/shopify/prices');
    const {
      categoryOptionValue,
      sizeOptionValue,
      CATEGORY_OPTION_NAME,
      SIZE_OPTION_NAME,
    } = await import('@/lib/shopify/pricing-options');
    mockShopifyFetch.mockResolvedValue({
      product: {
        variants: {
          edges: [
            {
              node: {
                id: 'gid://shopify/ProductVariant/v2mos3',
                availableForSale: true,
                price: { amount: '200.0' },
                selectedOptions: [
                  { name: CATEGORY_OPTION_NAME, value: categoryOptionValue('mosaicos') },
                  { name: SIZE_OPTION_NAME, value: sizeOptionValue(3) },
                ],
              },
            },
          ],
        },
      },
    });
    const { matrix } = await getPricingForCheckout();
    expect(matrix.mosaicos?.[3]?.variantId).toBe('gid://shopify/ProductVariant/v2mos3');
  });

  test('checkout read is UNCACHED — a warm cache cannot mask a now-unreadable v2 (Codex final audit)', async () => {
    const { getPricingForCheckout, PricingProductNotLiveError } = await import(
      '@/lib/shopify/prices'
    );
    // A prior success would warm the 60s display cache…
    mockShopifyFetch.mockResolvedValueOnce({ product: { variants: { edges: [] } } });
    await getPricingForCheckout();
    // …but v2 is now unreadable, and checkout must STILL fail closed (not serve
    // the stale matrix). getPricingForCheckout re-reads fresh every call.
    mockShopifyFetch.mockResolvedValueOnce({ product: null });
    await expect(getPricingForCheckout()).rejects.toBeInstanceOf(PricingProductNotLiveError);
    // The checkout read must bypass Next's fetch data cache.
    expect(mockShopifyFetch).toHaveBeenLastCalledWith(
      expect.objectContaining({ options: expect.objectContaining({ cache: 'no-store' }) }),
    );
  });
});
