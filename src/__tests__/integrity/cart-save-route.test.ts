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
vi.mock('@/lib/shopify/checkout', () => ({
  buildCartLines: (...args: unknown[]) => mockBuildCartLines(...args),
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

  test('non-empty items → createCart called, cookie set with 30-day maxAge', async () => {
    mockBuildCartLines.mockReturnValue([
      { merchandiseId: 'gid://shopify/ProductVariant/100', quantity: 1 },
    ]);
    mockCreateCart.mockResolvedValue({
      id: 'gid://shopify/Cart/new',
      checkoutUrl: 'https://shop.example/checkout/123',
    });

    const items = [{ id: 'a', name: 'Item', price: 100, quantity: 1, type: 'custom' }];
    const { POST } = await import('@/app/api/cart/save/route');
    const res = await POST(makeRequest({ items }));
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
});
