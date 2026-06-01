/**
 * UAT-6 PR1 contract test: /api/cart/load response shape + cartStatus.
 *
 * Locks the canonical reconciliation surface CartHydrator depends on:
 *   - no cookie                → { items: [], cartStatus: 'active' }
 *   - cookie + cart=null       → cookie deleted, { items: [], cartStatus: 'gone' }
 *   - cookie + cart, no state  → { items: [], cartStatus: 'active' }, cookie kept
 *   - cookie + cart, state=[]  → { items: [], cartStatus: 'active' }
 *   - cookie + cart, items     → { items, cartStatus: 'active' }
 *   - cookie + cart, bad json  → { items: [], cartStatus: 'active' }, cookie kept
 */
import { describe, test, expect, vi, beforeEach } from 'vitest';

const mockDelete = vi.fn();
const mockGet = vi.fn();
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({
    get: mockGet,
    delete: mockDelete,
  })),
}));

const mockGetCart = vi.fn();
vi.mock('@/lib/shopify/queries/cart', () => ({
  getCart: (...args: unknown[]) => mockGetCart(...args),
}));

beforeEach(() => {
  mockDelete.mockReset();
  mockGet.mockReset();
  mockGetCart.mockReset();
  vi.stubEnv('NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN', 'mosaiko.myshopify.com');
  vi.stubEnv('NEXT_PUBLIC_SHOPIFY_STOREFRONT_TOKEN', 'test-token');
});

describe('GET /api/cart/load', () => {
  test('no cookie → active empty', async () => {
    mockGet.mockReturnValue(undefined);
    const { GET } = await import('@/app/api/cart/load/route');
    const res = await GET();
    const body = await res.json();
    expect(body).toEqual({ items: [], cartStatus: 'active' });
    expect(mockDelete).not.toHaveBeenCalled();
    expect(mockGetCart).not.toHaveBeenCalled();
  });

  test('cookie + getCart returns null → cookie deleted + cartStatus gone', async () => {
    mockGet.mockReturnValue({ value: 'gid://shopify/Cart/abc' });
    mockGetCart.mockResolvedValue(null);
    const { GET } = await import('@/app/api/cart/load/route');
    const res = await GET();
    const body = await res.json();
    expect(body).toEqual({ items: [], cartStatus: 'gone' });
    expect(mockDelete).toHaveBeenCalledWith('mosaiko_cart_id');
  });

  test('cookie + cart exists + no mosaiko_state → active empty, cookie kept', async () => {
    mockGet.mockReturnValue({ value: 'gid://shopify/Cart/abc' });
    mockGetCart.mockResolvedValue({ id: 'cart-id', attributes: [] });
    const { GET } = await import('@/app/api/cart/load/route');
    const res = await GET();
    const body = await res.json();
    expect(body).toEqual({ items: [], cartStatus: 'active' });
    expect(mockDelete).not.toHaveBeenCalled();
  });

  test('cookie + cart exists + mosaiko_state=[] → active empty', async () => {
    mockGet.mockReturnValue({ value: 'gid://shopify/Cart/abc' });
    mockGetCart.mockResolvedValue({
      id: 'cart-id',
      attributes: [{ key: 'mosaiko_state', value: '[]' }],
    });
    const { GET } = await import('@/app/api/cart/load/route');
    const res = await GET();
    const body = await res.json();
    expect(body).toEqual({ items: [], cartStatus: 'active' });
    expect(mockDelete).not.toHaveBeenCalled();
  });

  test('cookie + cart exists + valid items → active with items', async () => {
    const items = [{ id: 'a', name: 'Item A', price: 100, quantity: 1 }];
    mockGet.mockReturnValue({ value: 'gid://shopify/Cart/abc' });
    mockGetCart.mockResolvedValue({
      id: 'cart-id',
      attributes: [{ key: 'mosaiko_state', value: JSON.stringify(items) }],
    });
    const { GET } = await import('@/app/api/cart/load/route');
    const res = await GET();
    const body = await res.json();
    expect(body.cartStatus).toBe('active');
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({ id: 'a', name: 'Item A' });
    expect(mockDelete).not.toHaveBeenCalled();
  });

  test('cookie + cart exists + malformed JSON → active empty, cookie kept', async () => {
    mockGet.mockReturnValue({ value: 'gid://shopify/Cart/abc' });
    mockGetCart.mockResolvedValue({
      id: 'cart-id',
      attributes: [{ key: 'mosaiko_state', value: '{not json' }],
    });
    const { GET } = await import('@/app/api/cart/load/route');
    const res = await GET();
    const body = await res.json();
    expect(body).toEqual({ items: [], cartStatus: 'active' });
    expect(mockDelete).not.toHaveBeenCalled();
  });

  test('cookie + getCart throws → active empty (transient error), cookie kept', async () => {
    mockGet.mockReturnValue({ value: 'gid://shopify/Cart/abc' });
    mockGetCart.mockRejectedValue(new Error('network'));
    const { GET } = await import('@/app/api/cart/load/route');
    const res = await GET();
    const body = await res.json();
    expect(body).toEqual({ items: [], cartStatus: 'active' });
    expect(mockDelete).not.toHaveBeenCalled();
  });
});
