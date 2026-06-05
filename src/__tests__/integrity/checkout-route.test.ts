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
// (absent in this env). Mock prices so only the piece checkout.ts imports
// exists; createCheckout is stubbed anyway.
vi.mock('@/lib/shopify/prices', () => ({
  getPricingForCheckout: async () => ({ migrated: false, matrix: {} }),
}));

function makeRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/checkout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const ITEMS = [{ id: 'a', name: 'Item', price: 480, quantity: 1, type: 'custom' }];

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
});
