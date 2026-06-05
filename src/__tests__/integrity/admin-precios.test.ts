/**
 * Admin price editor contract: every combo — including the single tile
 * (mosaicos:1) — is a normal, freely-editable price. No auto-derivation, no
 * read-only rows (the client sets the single-tile price to whatever he wants).
 */
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockVerifySession = vi.fn(async () => true);
vi.mock('@/lib/admin/auth', () => ({ verifySession: () => mockVerifySession() }));

const mockGetMatrix = vi.fn();
vi.mock('@/lib/shopify/prices', () => ({
  getPriceMatrix: () => mockGetMatrix(),
  PRICE_MATRIX_TAG: 'shopify:price-matrix',
}));

const mockGetProductId = vi.fn(async () => 'gid://shopify/Product/1');
const mockBulkUpdate = vi.fn(async () => undefined);
vi.mock('@/lib/shopify/mutations/product-variants', () => ({
  getPricingProductId: () => mockGetProductId(),
  bulkUpdateVariantPrices: (...args: unknown[]) => mockBulkUpdate(...args),
}));

vi.mock('@/lib/shopify/mutations/metaobjects', () => ({
  ShopifyUserErrorsError: class extends Error {},
}));

const mockRevalidate = vi.fn();
vi.mock('next/cache', () => ({ revalidateTag: (...a: unknown[]) => mockRevalidate(...a) }));

function cell(price: number, variantId: string) {
  return { price, variantId, availableForSale: true, source: 'shopify' as const };
}
function buildMatrix() {
  return {
    mosaicos: {
      1: cell(67, 'v-mos-1'),
      3: cell(200, 'v-mos-3'),
      6: cell(360, 'v-mos-6'),
      9: cell(480, 'v-mos-9'),
    },
    studio: { 6: cell(480, 'v-stu-6') },
  };
}
function putReq(updates: unknown): NextRequest {
  return new NextRequest('http://localhost/api/admin/precios', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ updates }),
  });
}
function sentUpdates(): Record<string, number> {
  const [, updates] = mockBulkUpdate.mock.calls[0] as [string, { variantId: string; price: number }[]];
  return Object.fromEntries(updates.map((u) => [u.variantId, u.price]));
}

beforeEach(() => {
  mockVerifySession.mockReset();
  mockVerifySession.mockResolvedValue(true);
  mockGetMatrix.mockReset();
  mockGetMatrix.mockResolvedValue(buildMatrix());
  mockGetProductId.mockReset();
  mockGetProductId.mockResolvedValue('gid://shopify/Product/1');
  mockBulkUpdate.mockReset();
  mockBulkUpdate.mockResolvedValue(undefined);
  mockRevalidate.mockReset();
});

describe('PUT /api/admin/precios — single tile is freely editable', () => {
  test('editing mosaicos:1 directly is ALLOWED (200) and writes that variant', async () => {
    const { PUT } = await import('@/app/api/admin/precios/route');
    const res = await PUT(putReq([{ category: 'mosaicos', gridSize: 1, price: 90 }]));
    expect(res.status).toBe(200);
    expect(sentUpdates()['v-mos-1']).toBe(90);
    expect(mockRevalidate).toHaveBeenCalled();
  });

  test('editing mosaicos:3 does NOT auto-touch the single tile', async () => {
    const { PUT } = await import('@/app/api/admin/precios/route');
    const res = await PUT(putReq([{ category: 'mosaicos', gridSize: 3, price: 240 }]));
    expect(res.status).toBe(200);
    const sent = sentUpdates();
    expect(sent['v-mos-3']).toBe(240);
    expect(sent['v-mos-1']).toBeUndefined(); // no derivation / resync
  });

  test('editing another category writes only that category', async () => {
    const { PUT } = await import('@/app/api/admin/precios/route');
    const res = await PUT(putReq([{ category: 'studio', gridSize: 6, price: 500 }]));
    expect(res.status).toBe(200);
    const sent = sentUpdates();
    expect(sent['v-stu-6']).toBe(500);
    expect(sent['v-mos-1']).toBeUndefined();
  });

  test('duplicate edits for a combo → last write wins', async () => {
    const { PUT } = await import('@/app/api/admin/precios/route');
    const res = await PUT(
      putReq([
        { category: 'mosaicos', gridSize: 3, price: 210 },
        { category: 'mosaicos', gridSize: 3, price: 240 },
      ]),
    );
    expect(res.status).toBe(200);
    expect(sentUpdates()['v-mos-3']).toBe(240);
  });
});

describe('GET /api/admin/precios — single tile editable', () => {
  test('mosaicos:1 row is editable; no derived/read-only flag', async () => {
    const { GET } = await import('@/app/api/admin/precios/route');
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      migrated: boolean;
      rows: { category: string; gridSize: number; editable: boolean; derived?: boolean }[];
    };
    const single = body.rows.find((r) => r.category === 'mosaicos' && r.gridSize === 1);
    expect(single?.editable).toBe(true);
    expect(single?.derived).toBeUndefined();
    expect(body.migrated).toBe(true);
  });
});
