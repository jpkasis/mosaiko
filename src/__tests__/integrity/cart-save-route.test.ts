/**
 * UAT-6 PR1 contract test: /api/cart/save empty-cart no-op + cookie attrs.
 *
 * The cart-empty-on-checkout-back bug came from this route deleting the
 * `mosaiko_cart_id` cookie whenever items=[] arrived. The PR1 fix locks:
 *   - POST { items: [] } with cookie       → 204, cookie NOT deleted
 *   - POST { items: [] } without cookie    → 204, no createCart call
 *   - POST { items: [...] }                → createCart called, cookie set
 *                                            with 30-day maxAge
 *   - Response shape preserved             → { cartId, checkoutUrl } unchanged
 */
import { describe, test, expect, vi, beforeEach } from 'vitest';

const mockDelete = vi.fn();
const mockSet = vi.fn();
const mockGet = vi.fn();
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({
    get: mockGet,
    set: mockSet,
    delete: mockDelete,
  })),
}));

const mockCreateCart = vi.fn();
vi.mock('@/lib/shopify/mutations/cart', () => ({
  createCart: (...args: unknown[]) => mockCreateCart(...args),
}));

const mockBuildCartLines = vi.fn();
vi.mock('@/lib/shopify/checkout', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/shopify/checkout')>();
  return {
    ...actual,
    // Only buildCartLines is stubbed; `assertCartTotalMatchesDisplay` stays
    // REAL so the 409 gate is exercised against the mocked cart's subtotal.
    buildCartLines: (...args: unknown[]) => mockBuildCartLines(...args),
  };
});

// Loading the real checkout module above pulls in prices.ts, which imports
// `server-only` (absent in this env). Mock prices so the pieces checkout.ts
// imports are present — buildCartLines is stubbed anyway.
// getCheapestStandardPrice feeds the PR-C minimum-order gate (controllable).
const mockCheapestStandard = vi.fn(async (): Promise<number | null> => 1);
vi.mock('@/lib/shopify/prices', () => ({
  getPricingForCheckout: async () => ({ migrated: false, matrix: {} }),
  getCheapestStandardPrice: () => mockCheapestStandard(),
}));

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/cart/save', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  mockDelete.mockReset();
  mockSet.mockReset();
  mockGet.mockReset();
  mockCreateCart.mockReset();
  mockBuildCartLines.mockReset();
  mockCheapestStandard.mockReset();
  mockCheapestStandard.mockResolvedValue(1); // minimum met by default
  vi.stubEnv('NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN', 'mosaiko.myshopify.com');
  vi.stubEnv('NEXT_PUBLIC_SHOPIFY_STOREFRONT_TOKEN', 'test-token');
  vi.stubEnv('NODE_ENV', 'test');
});

describe('POST /api/cart/save', () => {
  test('empty items with cookie → 204, cookie NOT deleted', async () => {
    mockGet.mockReturnValue({ value: 'gid://shopify/Cart/abc' });
    const { POST } = await import('@/app/api/cart/save/route');
    const res = await POST(makeRequest({ items: [] }));
    expect(res.status).toBe(204);
    expect(mockDelete).not.toHaveBeenCalled();
    expect(mockCreateCart).not.toHaveBeenCalled();
  });

  test('empty items without cookie → 204, no createCart call', async () => {
    mockGet.mockReturnValue(undefined);
    const { POST } = await import('@/app/api/cart/save/route');
    const res = await POST(makeRequest({ items: [] }));
    expect(res.status).toBe(204);
    expect(mockCreateCart).not.toHaveBeenCalled();
    expect(mockSet).not.toHaveBeenCalled();
  });

  // A created Shopify cart, including the `cost.subtotalAmount` the PR-B gate
  // checks the displayed total against (this cart costs $100).
  function mockSavedCart() {
    mockBuildCartLines.mockReturnValue([
      { merchandiseId: 'gid://shopify/ProductVariant/100', quantity: 1 },
    ]);
    mockCreateCart.mockResolvedValue({
      id: 'gid://shopify/Cart/new',
      checkoutUrl: 'https://shop.example/checkout/123',
      cost: { subtotalAmount: { amount: '100', currencyCode: 'MXN' } },
    });
  }

  test('checkout path (displayedTotal matches) → createCart, cookie set, returns checkoutUrl', async () => {
    mockSavedCart();

    const items = [{ id: 'a', name: 'Item', price: 100, quantity: 1, type: 'custom' }];
    const { POST } = await import('@/app/api/cart/save/route');
    const res = await POST(makeRequest({ items, displayedTotal: 100 }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      cartId: 'gid://shopify/Cart/new',
      checkoutUrl: 'https://shop.example/checkout/123',
    });
    expect(mockCreateCart).toHaveBeenCalledTimes(1);
    expect(mockSet).toHaveBeenCalledTimes(1);
    const cookieArg = mockSet.mock.calls[0][0];
    expect(cookieArg).toMatchObject({
      name: 'mosaiko_cart_id',
      value: 'gid://shopify/Cart/new',
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 30, // 30 days
    });
  });

  test('beacon path (no displayedTotal) → persists + cookie set, but NO checkoutUrl', async () => {
    mockSavedCart();

    const items = [{ id: 'a', name: 'Item', price: 100, quantity: 1, type: 'custom' }];
    const { POST } = await import('@/app/api/cart/save/route');
    const res = await POST(makeRequest({ items }));
    expect(res.status).toBe(200);
    const body = await res.json();
    // PR-B (Codex 3rd audit): the persistence-only beacon never gets a redirect
    // URL it could act on at an unverified price.
    expect(body).toEqual({ cartId: 'gid://shopify/Cart/new' });
    expect(body.checkoutUrl).toBeUndefined();
    expect(mockCreateCart).toHaveBeenCalledTimes(1);
    expect(mockSet).toHaveBeenCalledTimes(1); // cart still persisted + cookie set
  });

  test('displayed total drifted from the real cart subtotal → 409 PRICES_CHANGED', async () => {
    mockSavedCart(); // cart really costs $100

    const items = [{ id: 'a', name: 'Item', price: 80, quantity: 1, type: 'custom' }];
    const { POST } = await import('@/app/api/cart/save/route');
    const res = await POST(makeRequest({ items, displayedTotal: 80 }));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe('PRICES_CHANGED');
    expect(body.total).toBe(100); // the real amount Shopify will charge
    // The cart was still persisted (cookie set) so a retry reuses the corrected cart.
    expect(mockSet).toHaveBeenCalledTimes(1);
  });

  test('untrustworthy cart subtotal (non-MXN currency) → 502, NO checkoutUrl', async () => {
    // PR-B Codex 4th-audit: the gate fails CLOSED when it can't establish a
    // trustworthy MXN charge total — never hands back a redirect URL.
    mockBuildCartLines.mockReturnValue([
      { merchandiseId: 'gid://shopify/ProductVariant/100', quantity: 1 },
    ]);
    mockCreateCart.mockResolvedValue({
      id: 'gid://shopify/Cart/new',
      checkoutUrl: 'https://shop.example/checkout/123',
      cost: { subtotalAmount: { amount: '100', currencyCode: 'USD' } },
    });

    const items = [{ id: 'a', name: 'Item', price: 100, quantity: 1, type: 'custom' }];
    const { POST } = await import('@/app/api/cart/save/route');
    const res = await POST(makeRequest({ items, displayedTotal: 100 }));
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.code).toBe('CART_SUBTOTAL_UNAVAILABLE');
    expect(body.checkoutUrl).toBeUndefined();
  });

  test('PR-C: under minimum order → 422 MINIMUM_ORDER_NOT_MET, NO checkoutUrl', async () => {
    mockCheapestStandard.mockResolvedValue(200);
    mockBuildCartLines.mockReturnValue([
      { merchandiseId: 'gid://shopify/ProductVariant/100', quantity: 1 },
    ]);
    mockCreateCart.mockResolvedValue({
      id: 'gid://shopify/Cart/new',
      checkoutUrl: 'https://shop.example/checkout/123',
      cost: { subtotalAmount: { amount: '67', currencyCode: 'MXN' } }, // lone single tile
    });

    const items = [{ id: 'a', name: 'Item', price: 67, quantity: 1, type: 'custom' }];
    const { POST } = await import('@/app/api/cart/save/route');
    const res = await POST(makeRequest({ items, displayedTotal: 67 }));
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.code).toBe('MINIMUM_ORDER_NOT_MET');
    expect(body.minimum).toBe(200);
    expect(body.checkoutUrl).toBeUndefined();
    // The cart was still persisted (cookie set) so adding more items works.
    expect(mockSet).toHaveBeenCalledTimes(1);
  });
});
