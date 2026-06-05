/**
 * PR-B money-path contract tests (added per Codex audit).
 *
 * Pin the fail-closed pricing rules so a future change can't silently charge
 * the wrong price:
 *   - migrated + live v2 cell        → charge the v2 variant
 *   - migrated + missing combo       → FAIL CLOSED (no legacy fallback)
 *   - Shopify read error             → PRICING_UNAVAILABLE (never guesses)
 *   - not migrated (pre-publish)     → legacy size-only variant
 * Plus cart repricing from the live map and the option-label round-trip the
 * migration + reader both depend on.
 */
import { describe, test, expect, vi, beforeEach } from 'vitest';

const mockPricing = vi.fn();
vi.mock('@/lib/shopify/prices', () => ({
  getPricingForCheckout: () => mockPricing(),
}));

import { buildCartLines, assertCartTotalMatchesDisplay } from '@/lib/shopify/checkout';
import { cartItemUnitPrice } from '@/lib/cart-pricing';
import {
  sizeOptionValue,
  sizeFromOptionValue,
  categoryOptionValue,
  categoryFromOptionValue,
  PRICING_COMBOS,
} from '@/lib/shopify/pricing-options';
import type { CartItem } from '@/lib/cart-store';
import type { CategoryType } from '@/lib/customization-types';
import type { GridSize } from '@/lib/grid-config';

beforeEach(() => {
  vi.stubEnv(
    'SHOPIFY_VARIANT_MAP',
    JSON.stringify({ '6': 'gid://shopify/ProductVariant/legacy6' }),
  );
  mockPricing.mockReset();
});

function customItem(category: CategoryType, gridSize: GridSize): CartItem {
  return {
    id: 'x',
    type: 'custom',
    name: 'test',
    gridSize,
    gridLayout: { rows: 3, cols: 2 },
    price: 0,
    quantity: 1,
    previewUrl: '',
    tileUrls: [],
    customizations: {
      categoryType: category,
      photoStorageUrl: 'https://cdn.shopify.com/p.jpg',
      cropArea: { x: 0, y: 0, width: 1, height: 1 },
    },
  };
}

describe('PR-B checkout pricing — fail closed', () => {
  test('migrated + live cell → charges the v2 variant (not legacy)', async () => {
    mockPricing.mockResolvedValue({
      migrated: true,
      matrix: {
        studio: {
          6: { price: 480, variantId: 'gid://shopify/ProductVariant/v2studio6', availableForSale: true, source: 'shopify' },
        },
      },
    });
    const result = await buildCartLines([customItem('studio', 6)]);
    expect(Array.isArray(result)).toBe(true);
    if (!Array.isArray(result)) return;
    expect(result[0].merchandiseId).toBe('gid://shopify/ProductVariant/v2studio6');
  });

  test('migrated + missing combo → VARIANT_NOT_FOUND (never charges legacy size price)', async () => {
    mockPricing.mockResolvedValue({ migrated: true, matrix: {} });
    const result = await buildCartLines([customItem('studio', 6)]);
    expect(Array.isArray(result)).toBe(false);
    if (Array.isArray(result)) return;
    expect(result.code).toBe('VARIANT_NOT_FOUND');
  });

  test('migrated + unavailable variant → fails closed', async () => {
    mockPricing.mockResolvedValue({
      migrated: true,
      matrix: { studio: { 6: { price: 480, variantId: 'gid://x', availableForSale: false, source: 'shopify' } } },
    });
    const result = await buildCartLines([customItem('studio', 6)]);
    expect(Array.isArray(result)).toBe(false);
  });

  test('Shopify read error → PRICING_UNAVAILABLE (no guessed price)', async () => {
    mockPricing.mockRejectedValue(new Error('shopify down'));
    const result = await buildCartLines([customItem('studio', 6)]);
    expect(Array.isArray(result)).toBe(false);
    if (Array.isArray(result)) return;
    expect(result.code).toBe('PRICING_UNAVAILABLE');
  });

  test('not migrated (pre-publish) → legacy size-only variant', async () => {
    mockPricing.mockResolvedValue({ migrated: false, matrix: {} });
    const result = await buildCartLines([customItem('studio', 6)]);
    expect(Array.isArray(result)).toBe(true);
    if (!Array.isArray(result)) return;
    expect(result[0].merchandiseId).toBe('gid://shopify/ProductVariant/legacy6');
  });

  test('invalid (category, size) combo → VARIANT_NOT_FOUND when MIGRATED', async () => {
    // studio only allows 6 piezas; studio:3 is not a real combo.
    mockPricing.mockResolvedValue({ migrated: true, matrix: {} });
    const result = await buildCartLines([customItem('studio', 3)]);
    expect(Array.isArray(result)).toBe(false);
    if (Array.isArray(result)) return;
    expect(result.code).toBe('VARIANT_NOT_FOUND');
  });

  test('invalid combo is rejected even in the LEGACY fallback (not migrated)', async () => {
    // Codex full audit: without the combo guard, the size-only fallback would
    // charge the legacy 3-piece price for a studio (6-piece) print. Fail closed.
    mockPricing.mockResolvedValue({ migrated: false, matrix: {} });
    const result = await buildCartLines([customItem('studio', 3)]);
    expect(Array.isArray(result)).toBe(false);
    if (Array.isArray(result)) return;
    expect(result.code).toBe('VARIANT_NOT_FOUND');
  });
});

describe('PR-B cart repricing', () => {
  test('cartItemUnitPrice uses the live map price', () => {
    expect(cartItemUnitPrice({ studio: { 6: 480 } }, customItem('studio', 6))).toBe(480);
  });
  test('falls back to legacy grid-config when absent from the map', () => {
    // GRID_CONFIGS[6].price = 360
    expect(cartItemUnitPrice({}, customItem('mosaicos', 6))).toBe(360);
  });
});

describe('PR-B checkout total gate (display === Shopify cart subtotal)', () => {
  // The gate compares the customer's displayed total against the REAL subtotal
  // Shopify put in the created cart (amount + currency) — the exact amount
  // that will be charged.
  const mxn = (amount: string) => ({ amount, currencyCode: 'MXN' });

  test('subtotal matches displayed total → proceeds (null, no block)', () => {
    expect(assertCartTotalMatchesDisplay(mxn('480'), 480)).toBeNull();
  });

  test('subtotal drifted from displayed → PRICES_CHANGED (409) carrying the real subtotal', () => {
    // Customer still showing $360 while the cart Shopify built costs $480.
    const result = assertCartTotalMatchesDisplay(mxn('480'), 360);
    expect(result?.code).toBe('PRICES_CHANGED');
    expect(result?.status).toBe(409);
    expect(result?.total).toBe(480);
  });

  test('no displayedTotal (e.g. pagehide beacon) → skipped (null)', () => {
    expect(assertCartTotalMatchesDisplay(mxn('480'), undefined)).toBeNull();
  });

  test('compares in cents — sub-peso noise tolerated, a real cent diff blocks', () => {
    expect(assertCartTotalMatchesDisplay(mxn('480.004'), 480)).toBeNull();
    expect(assertCartTotalMatchesDisplay(mxn('480.01'), 480)?.code).toBe('PRICES_CHANGED');
  });

  test('FAILS CLOSED: missing / NaN subtotal → CART_SUBTOTAL_UNAVAILABLE (502), never passes', () => {
    expect(assertCartTotalMatchesDisplay(undefined, 480)?.code).toBe('CART_SUBTOTAL_UNAVAILABLE');
    expect(assertCartTotalMatchesDisplay(undefined, 480)?.status).toBe(502);
    expect(
      assertCartTotalMatchesDisplay({ amount: 'not-a-number', currencyCode: 'MXN' }, 480)?.code,
    ).toBe('CART_SUBTOTAL_UNAVAILABLE');
  });

  test('FAILS CLOSED: non-MXN currency never numerically matches (480 USD ≠ 480 MXN)', () => {
    const result = assertCartTotalMatchesDisplay({ amount: '480', currencyCode: 'USD' }, 480);
    expect(result?.code).toBe('CART_SUBTOTAL_UNAVAILABLE');
    expect(result?.status).toBe(502);
  });
});

describe('PR-B option-label round-trip (migration ↔ reader)', () => {
  test('size label round-trips', () => {
    expect(sizeFromOptionValue(sizeOptionValue(6))).toBe(6);
    expect(sizeFromOptionValue(sizeOptionValue(3))).toBe(3);
  });
  test('category label round-trips', () => {
    expect(categoryFromOptionValue(categoryOptionValue('studio'))).toBe('studio');
    expect(categoryFromOptionValue(categoryOptionValue('save-the-date'))).toBe('save-the-date');
  });
  test('combos include studio:6 and mosaicos 3/6/9', () => {
    const keys = new Set(PRICING_COMBOS.map((c) => `${c.category}:${c.gridSize}`));
    expect(keys.has('studio:6')).toBe(true);
    expect(keys.has('mosaicos:3')).toBe(true);
    expect(keys.has('mosaicos:9')).toBe(true);
  });
});
