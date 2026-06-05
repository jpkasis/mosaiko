/**
 * PR-C admin price editor — derive-on-save contract (Codex backend design).
 *
 *   - editing the 3-piece also writes mosaicos:1 = ⌈3-piece / 3⌉
 *   - editing anything else still RE-SYNCS mosaicos:1 from the current 3-piece
 *   - a no-op derived value is not re-written
 *   - a DIRECT edit of mosaicos:1 is rejected (400), not silently applied
 *   - GET flags the single-tile row derived + non-editable
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
function buildMatrix(singleTilePrice = 67) {
  return {
    mosaicos: {
      1: cell(singleTilePrice, 'v-mos-1'),
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
/** The (variantId → price) pairs sent to Shopify in the bulk update. */
function sentUpdates(): Record<string, number> {
  const [, updates] = mockBulkUpdate.mock.calls[0] as [string, { variantId: string; price: number }[]];
  return Object.fromEntries(updates.map((u) => [u.variantId, u.price]));
}

beforeEach(() => {
  mockVerifySession.mockReset();
  mockVerifySession.mockResolvedValue(true);
  mockGetMatrix.mockReset();
  mockGetMatrix.mockResolvedValue(buildMatrix(67));
  mockGetProductId.mockReset();
  mockGetProductId.mockResolvedValue('gid://shopify/Product/1');
  mockBulkUpdate.mockReset();
  mockBulkUpdate.mockResolvedValue(undefined);
  mockRevalidate.mockReset();
});

describe('PUT /api/admin/precios — derive-on-save', () => {
  test('editing the 3-piece also writes mosaicos:1 = ⌈3/3⌉', async () => {
    const { PUT } = await import('@/app/api/admin/precios/route');
    const res = await PUT(putReq([{ category: 'mosaicos', gridSize: 3, price: 240 }]));
    expect(res.status).toBe(200);
    const sent = sentUpdates();
    expect(sent['v-mos-3']).toBe(240);
    expect(sent['v-mos-1']).toBe(80); // ⌈240/3⌉
    expect(mockRevalidate).toHaveBeenCalled();
  });

  test('editing another category still re-syncs mosaicos:1 from the current 3-piece', async () => {
    // single-tile is stale at 60 while 3-piece is 200 → re-sync to 67.
    mockGetMatrix.mockResolvedValue(buildMatrix(60));
    const { PUT } = await import('@/app/api/admin/precios/route');
    const res = await PUT(putReq([{ category: 'studio', gridSize: 6, price: 500 }]));
    expect(res.status).toBe(200);
    const sent = sentUpdates();
    expect(sent['v-stu-6']).toBe(500);
    expect(sent['v-mos-1']).toBe(67); // ⌈200/3⌉
  });

  test('does not re-write the single tile when already in sync', async () => {
    // 3-piece edited to 201 → ⌈201/3⌉ = 67, already 67 → no redundant write.
    const { PUT } = await import('@/app/api/admin/precios/route');
    const res = await PUT(putReq([{ category: 'mosaicos', gridSize: 3, price: 201 }]));
    expect(res.status).toBe(200);
    const sent = sentUpdates();
    expect(sent['v-mos-3']).toBe(201);
    expect(sent['v-mos-1']).toBeUndefined();
  });

  test('duplicate 3-piece edits → last wins, single tile derived from the LAST', async () => {
    // Codex PR-C audit: a crafted payload with two 3-piece prices must not
    // desync mosaicos:1 (it should derive from the final 3-piece, 240 → 80).
    const { PUT } = await import('@/app/api/admin/precios/route');
    const res = await PUT(
      putReq([
        { category: 'mosaicos', gridSize: 3, price: 210 },
        { category: 'mosaicos', gridSize: 3, price: 240 },
      ]),
    );
    expect(res.status).toBe(200);
    const sent = sentUpdates();
    expect(sent['v-mos-3']).toBe(240); // last write wins
    expect(sent['v-mos-1']).toBe(80); // ⌈240/3⌉, NOT ⌈210/3⌉=70
  });

  test('a DIRECT edit of mosaicos:1 is rejected (400), nothing written', async () => {
    const { PUT } = await import('@/app/api/admin/precios/route');
    const res = await PUT(putReq([{ category: 'mosaicos', gridSize: 1, price: 99 }]));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('DERIVED_PRICE_READ_ONLY');
    expect(mockBulkUpdate).not.toHaveBeenCalled();
  });
});

describe('GET /api/admin/precios — derived flag', () => {
  test('single-tile row is derived + non-editable; standard rows editable', async () => {
    const { GET } = await import('@/app/api/admin/precios/route');
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      migrated: boolean;
      rows: { category: string; gridSize: number; editable: boolean; derived?: boolean }[];
    };
    const single = body.rows.find((r) => r.category === 'mosaicos' && r.gridSize === 1);
    const three = body.rows.find((r) => r.category === 'mosaicos' && r.gridSize === 3);
    expect(single?.derived).toBe(true);
    expect(single?.editable).toBe(false);
    expect(three?.editable).toBe(true);
    expect(body.migrated).toBe(true);
  });
});
