/**
 * Admin order cancellation/refund SIGNAL overlay.
 *
 * `/admin/pedidos` derives the pipeline status (Nuevo→…→Entregado) from the
 * `mosaiko:fulfillment_status` metafield ONLY. That ignores an order the
 * client cancelled or refunded directly in Shopify — it would still show
 * "Nuevo" and sit in the actionable print queue.
 *
 * `getOrderSignals` reads Shopify's native cancellation/financial fields and
 * `isOrderActionable` decides whether the order stays in the print queue.
 * These tests pin both, plus the query-contract (the new Shopify fields +
 * cache:'no-store').
 */
import { describe, test, expect } from 'vitest';
import {
  getOrderSignals,
  isOrderActionable,
  ORDERS_QUERY,
  ORDER_BY_ID_QUERY,
  type AdminOrder,
} from '@/lib/shopify/queries/orders';

// ─── Fixture builder ──────────────────────────────────────────────────────────

type RefundTxn = { kind: string; status: string };

function makeOrder(overrides: {
  cancelledAt?: string | null;
  cancelReason?: string | null;
  displayFinancialStatus?: string;
  refundTxns?: RefundTxn[];
}): AdminOrder {
  const refundTxns = overrides.refundTxns ?? [];
  return {
    id: 'gid://shopify/Order/123',
    name: '#1001',
    orderNumber: 1001,
    createdAt: '2026-06-01T00:00:00Z',
    displayFinancialStatus: overrides.displayFinancialStatus ?? 'PAID',
    displayFulfillmentStatus: 'UNFULFILLED',
    cancelledAt: overrides.cancelledAt ?? null,
    cancelReason: overrides.cancelReason ?? null,
    refunds:
      refundTxns.length > 0
        ? [
            {
              id: 'gid://shopify/Refund/1',
              transactions: { edges: refundTxns.map((node) => ({ node })) },
            },
          ]
        : [],
    email: 'cliente@example.com',
    totalPriceSet: { shopMoney: { amount: '480.00', currencyCode: 'MXN' } },
    customer: { firstName: 'Ana', lastName: 'López' },
    shippingAddress: null,
    lineItems: { edges: [] },
    metafields: { edges: [] },
  };
}

// ─── getOrderSignals ───────────────────────────────────────────────────────────

describe('getOrderSignals', () => {
  test('normal PAID order → no signals', () => {
    expect(getOrderSignals(makeOrder({ displayFinancialStatus: 'PAID' }))).toEqual([]);
  });

  test('cancelled (cancelledAt set) → ["cancelled"]', () => {
    const order = makeOrder({ cancelledAt: '2026-06-02T10:00:00Z', cancelReason: 'CUSTOMER' });
    expect(getOrderSignals(order)).toContain('cancelled');
  });

  test('REFUNDED → ["refunded"]', () => {
    expect(getOrderSignals(makeOrder({ displayFinancialStatus: 'REFUNDED' }))).toEqual([
      'refunded',
    ]);
  });

  test('PARTIALLY_REFUNDED → ["partiallyRefunded"]', () => {
    expect(getOrderSignals(makeOrder({ displayFinancialStatus: 'PARTIALLY_REFUNDED' }))).toEqual([
      'partiallyRefunded',
    ]);
  });

  test('VOIDED → ["voided"]', () => {
    expect(getOrderSignals(makeOrder({ displayFinancialStatus: 'VOIDED' }))).toEqual(['voided']);
  });

  test('unpaid states (PENDING/AUTHORIZED/PARTIALLY_PAID/EXPIRED) → ["unpaid"]', () => {
    for (const fin of ['PENDING', 'AUTHORIZED', 'PARTIALLY_PAID', 'EXPIRED']) {
      expect(getOrderSignals(makeOrder({ displayFinancialStatus: fin }))).toEqual(['unpaid']);
    }
  });

  test('PAID + a REFUND txn status PENDING → ["refundPending"]', () => {
    const order = makeOrder({
      displayFinancialStatus: 'PAID',
      refundTxns: [{ kind: 'REFUND', status: 'PENDING' }],
    });
    expect(getOrderSignals(order)).toEqual(['refundPending']);
  });

  test('refund txn AWAITING_RESPONSE / UNKNOWN also count as pending', () => {
    expect(
      getOrderSignals(makeOrder({ refundTxns: [{ kind: 'REFUND', status: 'AWAITING_RESPONSE' }] })),
    ).toContain('refundPending');
    expect(
      getOrderSignals(makeOrder({ refundTxns: [{ kind: 'REFUND', status: 'UNKNOWN' }] })),
    ).toContain('refundPending');
  });

  test('a SUCCESS refund txn does NOT flag refundPending', () => {
    const order = makeOrder({
      displayFinancialStatus: 'PAID',
      refundTxns: [{ kind: 'REFUND', status: 'SUCCESS' }],
    });
    expect(getOrderSignals(order)).toEqual([]);
  });

  test('a non-REFUND pending txn (e.g. SALE) does NOT flag refundPending', () => {
    const order = makeOrder({
      displayFinancialStatus: 'PAID',
      refundTxns: [{ kind: 'SALE', status: 'PENDING' }],
    });
    expect(getOrderSignals(order)).toEqual([]);
  });

  test('cancelled + refunded → both, deduped', () => {
    const order = makeOrder({
      cancelledAt: '2026-06-02T10:00:00Z',
      displayFinancialStatus: 'REFUNDED',
    });
    const signals = getOrderSignals(order);
    expect(signals).toContain('cancelled');
    expect(signals).toContain('refunded');
    // Deduped — no repeats.
    expect(new Set(signals).size).toBe(signals.length);
  });

  test('null refunds field tolerated (no throw)', () => {
    const order = makeOrder({});
    // Simulate an order whose refunds came back null/absent.
    (order as { refunds: unknown }).refunds = null;
    expect(() => getOrderSignals(order)).not.toThrow();
    expect(getOrderSignals(order)).toEqual([]);
  });
});

// ─── isOrderActionable ─────────────────────────────────────────────────────────

describe('isOrderActionable', () => {
  test('normal PAID order → actionable', () => {
    expect(isOrderActionable(makeOrder({ displayFinancialStatus: 'PAID' }))).toBe(true);
  });

  test('cancelled → NOT actionable', () => {
    expect(isOrderActionable(makeOrder({ cancelledAt: '2026-06-02T10:00:00Z' }))).toBe(false);
  });

  test('REFUNDED → NOT actionable', () => {
    expect(isOrderActionable(makeOrder({ displayFinancialStatus: 'REFUNDED' }))).toBe(false);
  });

  test('VOIDED → NOT actionable', () => {
    expect(isOrderActionable(makeOrder({ displayFinancialStatus: 'VOIDED' }))).toBe(false);
  });

  test('unpaid (PENDING) → NOT actionable', () => {
    expect(isOrderActionable(makeOrder({ displayFinancialStatus: 'PENDING' }))).toBe(false);
  });

  test('PARTIALLY_REFUNDED → STILL actionable (flagged only)', () => {
    expect(isOrderActionable(makeOrder({ displayFinancialStatus: 'PARTIALLY_REFUNDED' }))).toBe(
      true,
    );
  });

  test('refundPending → STILL actionable (flagged only)', () => {
    const order = makeOrder({ refundTxns: [{ kind: 'REFUND', status: 'PENDING' }] });
    expect(isOrderActionable(order)).toBe(true);
  });
});

// ─── Query contract ────────────────────────────────────────────────────────────

describe('orders query contract', () => {
  test('ORDERS_QUERY selects the cancellation/refund fields', () => {
    for (const field of [
      'cancelledAt',
      'cancelReason',
      'refunds',
      'transactions',
      'kind',
      'status',
      'displayFinancialStatus',
      'displayFulfillmentStatus',
    ]) {
      expect(ORDERS_QUERY).toContain(field);
    }
  });

  test('ORDER_BY_ID_QUERY selects the cancellation/refund fields', () => {
    for (const field of [
      'cancelledAt',
      'cancelReason',
      'refunds',
      'transactions',
      'kind',
      'status',
    ]) {
      expect(ORDER_BY_ID_QUERY).toContain(field);
    }
  });

  test('getOrders/getOrderById read uncached (cache:no-store)', async () => {
    // The functions pass `options: { cache: 'no-store' }` to shopifyAdminFetch.
    // Assert on the module source so we don't need a live Shopify mock here.
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const src = await fs.readFile(
      path.resolve(process.cwd(), 'src/lib/shopify/queries/orders.ts'),
      'utf8',
    );
    expect(src).toContain("cache: 'no-store'");
  });
});
