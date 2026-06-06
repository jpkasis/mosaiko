/**
 * Server-side 409 guard for the cancellation/refund overlay.
 *
 * `guardOrderActionable` re-reads the order LIVE (getOrderById) and blocks
 * mutating/processing routes for a non-actionable order (cancelled / refunded
 * / voided) UNLESS the request carries an explicit confirm flag:
 *   - status PATCH / retry POST → `confirm: true` in the JSON body
 *   - print-files GET           → `?confirm=1` query
 * Blocked → 409 `{ error: { code: 'order_not_processable' } }`, no mutation.
 *
 * These mock `getOrderById` (so the guard sees a chosen order) while keeping
 * `isOrderActionable` REAL, and mock the session + each route's downstream
 * Shopify writers so the "with confirm proceeds" path is deterministic.
 */
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import type { AdminOrder } from '@/lib/shopify/queries/orders';

// ── Session ────────────────────────────────────────────────────────────────
const mockVerifySession = vi.fn();
vi.mock('@/lib/admin/auth', () => ({ verifySession: () => mockVerifySession() }));

// ── getOrderById (used by the guard). isOrderActionable stays REAL. ──────────
const mockGetOrderById = vi.fn();
vi.mock('@/lib/shopify/queries/orders', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/shopify/queries/orders')>();
  return { ...actual, getOrderById: (id: string) => mockGetOrderById(id) };
});

// ── status-route downstream writers (so "with confirm" is deterministic) ─────
const mockUpdateOrderMetafield = vi.fn();
const mockCreateFulfillment = vi.fn();
const mockSetOrderMetafields = vi.fn();
vi.mock('@/lib/shopify/mutations/orders', () => ({
  updateOrderMetafield: (...a: unknown[]) => mockUpdateOrderMetafield(...a),
  createFulfillment: (...a: unknown[]) => mockCreateFulfillment(...a),
  setOrderMetafields: (...a: unknown[]) => mockSetOrderMetafields(...a),
}));

const ORDER_ID = '123456';

function cancelledOrder(): AdminOrder {
  return {
    id: `gid://shopify/Order/${ORDER_ID}`,
    name: '#1001',
    orderNumber: 1001,
    createdAt: '2026-06-01T00:00:00Z',
    displayFinancialStatus: 'REFUNDED',
    displayFulfillmentStatus: 'UNFULFILLED',
    cancelledAt: '2026-06-02T10:00:00Z',
    cancelReason: 'CUSTOMER',
    refunds: [],
    email: 'cliente@example.com',
    totalPriceSet: { shopMoney: { amount: '480.00', currencyCode: 'MXN' } },
    customer: { firstName: 'Ana', lastName: 'López' },
    shippingAddress: null,
    lineItems: { edges: [] },
    metafields: { edges: [] },
  };
}

beforeEach(() => {
  mockVerifySession.mockReset();
  mockGetOrderById.mockReset();
  mockUpdateOrderMetafield.mockReset();
  mockCreateFulfillment.mockReset();
  mockSetOrderMetafields.mockReset();
  mockVerifySession.mockResolvedValue(true);
  mockGetOrderById.mockResolvedValue(cancelledOrder());
});

function patchReq(body: unknown): NextRequest {
  return new NextRequest(`http://localhost/api/admin/orders/${ORDER_ID}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}
const params = Promise.resolve({ orderId: ORDER_ID });

// ── status PATCH ─────────────────────────────────────────────────────────────

describe('status PATCH guard', () => {
  test('non-actionable order WITHOUT confirm → 409 order_not_processable, no mutation', async () => {
    const { PATCH } = await import('@/app/api/admin/orders/[orderId]/status/route');
    const res = await PATCH(patchReq({ status: 'imprimiendo' }), { params });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe('order_not_processable');
    expect(mockUpdateOrderMetafield).not.toHaveBeenCalled();
  });

  test('non-actionable order WITH confirm → proceeds (mutates, 200)', async () => {
    mockUpdateOrderMetafield.mockResolvedValue(undefined);
    const { PATCH } = await import('@/app/api/admin/orders/[orderId]/status/route');
    const res = await PATCH(patchReq({ status: 'imprimiendo', confirm: true }), { params });
    expect(res.status).toBe(200);
    expect(mockUpdateOrderMetafield).toHaveBeenCalledWith(
      ORDER_ID,
      'mosaiko',
      'fulfillment_status',
      'imprimiendo',
    );
  });

  test('actionable order WITHOUT confirm → proceeds (no 409)', async () => {
    mockGetOrderById.mockResolvedValue({ ...cancelledOrder(), cancelledAt: null, displayFinancialStatus: 'PAID' });
    mockUpdateOrderMetafield.mockResolvedValue(undefined);
    const { PATCH } = await import('@/app/api/admin/orders/[orderId]/status/route');
    const res = await PATCH(patchReq({ status: 'imprimiendo' }), { params });
    expect(res.status).toBe(200);
  });

  test('401 without session (guard never runs)', async () => {
    mockVerifySession.mockResolvedValue(false);
    const { PATCH } = await import('@/app/api/admin/orders/[orderId]/status/route');
    const res = await PATCH(patchReq({ status: 'imprimiendo' }), { params });
    expect(res.status).toBe(401);
    expect(mockGetOrderById).not.toHaveBeenCalled();
  });

  test('guard read error → 503 order_check_unavailable, no mutation (FAIL CLOSED)', async () => {
    mockGetOrderById.mockRejectedValue(new Error('shopify down'));
    const { PATCH } = await import('@/app/api/admin/orders/[orderId]/status/route');
    const res = await PATCH(patchReq({ status: 'imprimiendo' }), { params });
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error.code).toBe('order_check_unavailable');
    expect(mockUpdateOrderMetafield).not.toHaveBeenCalled();
  });
});

// ── retry POST ───────────────────────────────────────────────────────────────

describe('retry POST guard', () => {
  function retryReq(body?: unknown): NextRequest {
    return new NextRequest(`http://localhost/api/admin/orders/${ORDER_ID}/retry`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  test('non-actionable WITHOUT confirm → 409 order_not_processable', async () => {
    const { POST } = await import('@/app/api/admin/orders/[orderId]/retry/route');
    const res = await POST(retryReq({}), { params });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe('order_not_processable');
  });

  test('non-actionable WITHOUT body at all → 409 (parse failure = no confirm)', async () => {
    const { POST } = await import('@/app/api/admin/orders/[orderId]/retry/route');
    const res = await POST(retryReq(undefined), { params });
    expect(res.status).toBe(409);
  });

  test('non-actionable WITH confirm → past the guard (not a 409)', async () => {
    // With confirm the guard returns ok; the route then reaches its own
    // Shopify fetch which, without creds in the test env, 404s. The point is
    // it is NOT the guard's 409 order_not_processable.
    const { POST } = await import('@/app/api/admin/orders/[orderId]/retry/route');
    const res = await POST(retryReq({ confirm: true }), { params });
    expect(res.status).not.toBe(409);
  });
});

// ── print-files GET ──────────────────────────────────────────────────────────

describe('print-files GET guard', () => {
  function filesReq(confirm: boolean): NextRequest {
    const qs = `orderId=${ORDER_ID}${confirm ? '&confirm=1' : ''}`;
    return new NextRequest(`http://localhost/api/admin/print-files?${qs}`);
  }

  test('non-actionable WITHOUT confirm → 409 order_not_processable', async () => {
    const { GET } = await import('@/app/api/admin/print-files/route');
    const res = await GET(filesReq(false));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe('order_not_processable');
  });

  test('non-actionable WITH confirm=1 → past the guard (not order_not_processable)', async () => {
    const { GET } = await import('@/app/api/admin/print-files/route');
    const res = await GET(filesReq(true));
    // Downstream (no Shopify creds) → 503 shopify_unavailable, NOT the guard's 409.
    const body = await res.json().catch(() => ({}));
    expect(body?.error?.code).not.toBe('order_not_processable');
  });
});
