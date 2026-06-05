/**
 * Integrity test: server-side checkout guard
 *
 * UAT-1a added a defense-in-depth guard at `buildCartLines`: a cart
 * item of `type: 'predesigned'` must reference a catalog product
 * via `productId` whose category is purchase-as-is (Studio / Arte).
 * Round 2 (Codex audit) tightened the guard so it derives category
 * from the trusted catalog lookup instead of the client-supplied
 * `categorySlug` — a handcrafted POST could otherwise pair
 * `categorySlug: "studio"` with a Polaroid productId and bypass.
 *
 * Test matrix:
 *   - real Studio/Arte productId → accepted
 *   - real layout-example productId → rejected (LAYOUT_EXAMPLE_NOT_PURCHASABLE)
 *   - unknown productId → rejected (INVALID_PREDESIGNED_LINE)
 *   - missing productId → rejected (INVALID_PREDESIGNED_LINE)
 *   - spoofed categorySlug (studio claimed, real product is Polaroid) → rejected
 *   - custom-type line → always accepted regardless of category
 */
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { buildCartLines } from '@/lib/shopify/checkout';
import type { CartItem } from '@/lib/cart-store';

// PR-B: buildCartLines resolves pricing via getPricingForCheckout. Mock it as
// "not migrated" so it falls back to the legacy size-only SHOPIFY_VARIANT_MAP
// stub below — keeping these guard assertions about category/variant resolution.
vi.mock('@/lib/shopify/prices', () => ({
  getPricingForCheckout: async () => ({ migrated: false, matrix: {} }),
}));

beforeEach(() => {
  vi.stubEnv(
    'SHOPIFY_VARIANT_MAP',
    JSON.stringify({
      '3': 'gid://shopify/ProductVariant/100',
      '4': 'gid://shopify/ProductVariant/101',
      '6': 'gid://shopify/ProductVariant/102',
      '9': 'gid://shopify/ProductVariant/103',
    }),
  );
});

function makePredesignedItem(productId: string, categorySlug?: string): CartItem {
  return {
    id: 'cart-line-1',
    type: 'predesigned',
    name: 'Test product',
    gridSize: 6,
    gridLayout: { rows: 2, cols: 3 },
    price: 480,
    quantity: 1,
    previewUrl: '/products/test.png',
    tileUrls: [],
    productId,
    categorySlug,
  };
}

describe('buildCartLines — predesigned guard', () => {
  test('accepts predesigned line with real Studio productId', async () => {
    const result = await buildCartLines([makePredesignedItem('stu-1')]);
    expect(Array.isArray(result)).toBe(true);
  });

  test('accepts predesigned line with real Arte productId', async () => {
    const result = await buildCartLines([makePredesignedItem('art-1')]);
    expect(Array.isArray(result)).toBe(true);
  });

  test('rejects predesigned line referencing a Mosaicos product', async () => {
    const result = await buildCartLines([makePredesignedItem('mos-1')]);
    expect(Array.isArray(result)).toBe(false);
    if (Array.isArray(result)) return;
    expect(result.code).toBe('LAYOUT_EXAMPLE_NOT_PURCHASABLE');
  });

  test('rejects predesigned line referencing a Polaroid product', async () => {
    const result = await buildCartLines([makePredesignedItem('pol-1')]);
    expect(Array.isArray(result)).toBe(false);
    if (Array.isArray(result)) return;
    expect(result.code).toBe('LAYOUT_EXAMPLE_NOT_PURCHASABLE');
  });

  test('rejects predesigned line referencing a Tonos product', async () => {
    const result = await buildCartLines([makePredesignedItem('ton-1')]);
    expect(Array.isArray(result)).toBe(false);
    if (Array.isArray(result)) return;
    expect(result.code).toBe('LAYOUT_EXAMPLE_NOT_PURCHASABLE');
  });

  test('rejects predesigned line referencing a Spotify product', async () => {
    const result = await buildCartLines([makePredesignedItem('spo-1')]);
    expect(Array.isArray(result)).toBe(false);
    if (Array.isArray(result)) return;
    expect(result.code).toBe('LAYOUT_EXAMPLE_NOT_PURCHASABLE');
  });

  test('rejects predesigned line referencing the (now hidden) Save-the-Date 9-piece via std-1', async () => {
    // STD-1 is in catalog (9 pieces) but STD is layout-example.
    // Guard should reject any predesigned reference to it.
    const result = await buildCartLines([makePredesignedItem('std-1')]);
    expect(Array.isArray(result)).toBe(false);
    if (Array.isArray(result)) return;
    expect(result.code).toBe('LAYOUT_EXAMPLE_NOT_PURCHASABLE');
  });

  test('rejects predesigned line with missing productId', async () => {
    const item = makePredesignedItem('');
    delete (item as { productId?: string }).productId;
    const result = await buildCartLines([item]);
    expect(Array.isArray(result)).toBe(false);
    if (Array.isArray(result)) return;
    expect(result.code).toBe('INVALID_PREDESIGNED_LINE');
  });

  test('rejects predesigned line with unknown productId', async () => {
    const result = await buildCartLines([makePredesignedItem('not-a-real-id')]);
    expect(Array.isArray(result)).toBe(false);
    if (Array.isArray(result)) return;
    expect(result.code).toBe('INVALID_PREDESIGNED_LINE');
  });

  test('rejects spoofed categorySlug paired with mismatched productId', async () => {
    // Client claims studio (an as-is category) but productId resolves
    // to a Polaroid product (layout-example). Catalog lookup wins —
    // categorySlug is never trusted.
    const result = await buildCartLines([makePredesignedItem('pol-1', 'studio')]);
    expect(Array.isArray(result)).toBe(false);
    if (Array.isArray(result)) return;
    expect(result.code).toBe('LAYOUT_EXAMPLE_NOT_PURCHASABLE');
  });

  test('passes through a custom-type cart line regardless of category', async () => {
    const item: CartItem = {
      ...makePredesignedItem('pol-1'),
      type: 'custom',
      customizations: {
        categoryType: 'polaroid',
        photoStorageUrl: 'https://cdn.example.com/photo.png',
      },
    };
    const result = await buildCartLines([item]);
    expect(Array.isArray(result)).toBe(true);
  });
});
