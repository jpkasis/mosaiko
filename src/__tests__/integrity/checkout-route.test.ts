/**
 * PR-B (Codex 4th audit) — /api/checkout money-path route contract.
 *
 * /api/checkout always returns a redirect URL, so it must:
 *   - REQUIRE a finite displayedTotal (else 400, no cart created)
 *   - gate the URL on the cart's REAL Shopify subtotal:
 *       match    → 200 checkoutUrl
 *       drift    → 409 PRICES_CHANGED, no checkoutUrl
 *       non-MXN / untrustworthy total → 502, no checkoutUrl (fails closed)
 */
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockCreateCheckout = vi.fn();
vi.mock('@/lib/shopify/checkout', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/shopify/checkout')>();
  return {
    ...actual,
    // createCheckout is stubbed; assertCartTotalMatchesDisplay stays REAL so the
    // gate runs against the stubbed cart subtotal.
    createCheckout: (...args: unknown[]) => mockCreateCheckout(...args),
  };
});

// Real checkout module (loaded above) imports prices.ts → `server-only`
// (absent in this env). Mock prices so only the pieces checkout.ts imports
// exist; createCheckout is stubbed anyway. getDisplayPriceMap feeds the
// minimum-order gate, which now uses a FIXED MINIMUM_ORDER_MXN ($200) floor
// rather than a derived cheapest-standard price.
vi.mock('@/lib/shopify/prices', () => ({
  getPricingForCheckout: async () => ({ matrix: {} }),
  getDisplayPriceMap: async () => ({}),
}));

function makeRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/checkout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const ITEMS = [{ id: 'a', name: 'Item', price: 480, quantity: 1, type: 'custom' }];
// A lone single tile — cartLiveTotal prices it at GRID_CONFIGS[1] = $67.
const SINGLE_TILE = [
  {
    id: 's',
    name: '1 pieza',
    price: 67,
    quantity: 1,
    type: 'custom',
    gridSize: 1,
    gridLayout: { rows: 1, cols: 1 },
    previewUrl: '',
    tileUrls: [],
    customizations: {
      categoryType: 'mosaicos',
      photoStorageUrl: 'https://cdn.shopify.com/p.jpg',
      cropArea: { x: 0, y: 0, width: 1, height: 1 },
    },
  },
];

beforeEach(() => {
  mockCreateCheckout.mockReset();
});

describe('POST /api/checkout', () => {
  test('missing displayedTotal → 400 DISPLAYED_TOTAL_REQUIRED, no cart created', async () => {
    const { POST } = await import('@/app/api/checkout/route');
    const res = await POST(makeRequest({ items: ITEMS }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('DISPLAYED_TOTAL_REQUIRED');
    expect(mockCreateCheckout).not.toHaveBeenCalled();
  });

  test('matching displayedTotal → 200 checkoutUrl', async () => {
    mockCreateCheckout.mockResolvedValue({
      checkoutUrl: 'https://shop.example/checkout/x',
      cartId: 'gid://shopify/Cart/x',
      subtotal: { amount: '480', currencyCode: 'MXN' },
    });
    const { POST } = await import('@/app/api/checkout/route');
    const res = await POST(makeRequest({ items: ITEMS, displayedTotal: 480 }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.checkoutUrl).toBe('https://shop.example/checkout/x');
  });

  test('drifted displayedTotal → 409 PRICES_CHANGED, NO checkoutUrl', async () => {
    mockCreateCheckout.mockResolvedValue({
      checkoutUrl: 'https://shop.example/checkout/x',
      cartId: 'gid://shopify/Cart/x',
      subtotal: { amount: '480', currencyCode: 'MXN' },
    });
    const { POST } = await import('@/app/api/checkout/route');
    const res = await POST(makeRequest({ items: ITEMS, displayedTotal: 360 }));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe('PRICES_CHANGED');
    expect(body.total).toBe(480);
    expect(body.checkoutUrl).toBeUndefined();
  });

  test('non-MXN cart subtotal → 502 CART_SUBTOTAL_UNAVAILABLE, NO checkoutUrl', async () => {
    mockCreateCheckout.mockResolvedValue({
      checkoutUrl: 'https://shop.example/checkout/x',
      cartId: 'gid://shopify/Cart/x',
      subtotal: { amount: '480', currencyCode: 'USD' },
    });
    const { POST } = await import('@/app/api/checkout/route');
    const res = await POST(makeRequest({ items: ITEMS, displayedTotal: 480 }));
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.code).toBe('CART_SUBTOTAL_UNAVAILABLE');
    expect(body.checkoutUrl).toBeUndefined();
  });

  test('PR-C: under minimum → 422 BEFORE any cart is created (createCheckout NOT called)', async () => {
    // Floor is the fixed MINIMUM_ORDER_MXN ($200); the lone single tile ($67) is under.
    const { POST } = await import('@/app/api/checkout/route');
    const res = await POST(makeRequest({ items: SINGLE_TILE, displayedTotal: 67 }));
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.code).toBe('MINIMUM_ORDER_NOT_MET');
    expect(body.minimum).toBe(200);
    expect(body.total).toBe(67); // priced from the trusted server map, not the client
    expect(body.checkoutUrl).toBeUndefined();
    // BLOCKER fix: the gate runs before createCheckout → no Shopify cart exists.
    expect(mockCreateCheckout).not.toHaveBeenCalled();
  });
});
