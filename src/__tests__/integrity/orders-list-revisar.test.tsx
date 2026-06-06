// @vitest-environment jsdom
/**
 * OrdersListContent: non-actionable orders are excluded from the print-queue
 * status tabs (and their counts) and surface in the dedicated "Revisar" tab.
 * This keeps the Nuevos/Imprimiendo/Enviados/Entregados queue trustworthy.
 *
 *   - a cancelled order is NOT counted under "Nuevos"
 *   - it IS counted under "Revisar"
 *   - "Todos" still shows every order
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import React from 'react';
import type { AdminOrder } from '@/lib/shopify/queries/orders';

import { OrdersListContent } from '@/components/admin/OrdersListContent';

function makeOrder(partial: Partial<AdminOrder> & { id: string; name: string }): AdminOrder {
  return {
    orderNumber: 1000,
    createdAt: '2026-06-01T00:00:00Z',
    displayFinancialStatus: 'PAID',
    displayFulfillmentStatus: 'UNFULFILLED',
    cancelledAt: null,
    cancelReason: null,
    refunds: [],
    email: 'cliente@example.com',
    totalPriceSet: { shopMoney: { amount: '480.00', currencyCode: 'MXN' } },
    customer: { firstName: 'Ana', lastName: 'López' },
    shippingAddress: null,
    lineItems: { edges: [] },
    metafields: { edges: [] },
    ...partial,
  } as AdminOrder;
}

// Two "nuevo" (no fulfillment_status metafield → defaults to nuevo): one normal
// + one cancelled. The cancelled one must be excluded from Nuevos.
const ORDERS: AdminOrder[] = [
  makeOrder({ id: 'gid://shopify/Order/1', name: '#1001' }),
  makeOrder({
    id: 'gid://shopify/Order/2',
    name: '#1002',
    cancelledAt: '2026-06-02T10:00:00Z',
    displayFinancialStatus: 'REFUNDED',
  }),
];

beforeEach(() => {
  global.fetch = vi.fn(async () =>
    new Response(JSON.stringify({ orders: ORDERS }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  ) as unknown as typeof fetch;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function tabButton(label: string): HTMLElement {
  // Tab labels include a trailing "(n)" count span, so match by prefix.
  return screen
    .getAllByRole('button')
    .find((b) => b.textContent?.startsWith(label)) as HTMLElement;
}

describe('OrdersListContent — Revisar tab + queue exclusion', () => {
  test('cancelled order excluded from Nuevos count, present in Revisar count', async () => {
    render(<OrdersListContent />);
    await waitFor(() => expect(screen.getByText('#1001')).toBeTruthy());

    // Nuevos shows only the 1 actionable order; Revisar shows the 1 cancelled.
    expect(tabButton('Nuevos').textContent).toContain('(1)');
    expect(tabButton('Revisar').textContent).toContain('(1)');
  });

  test('"Nuevos" tab lists the actionable order but NOT the cancelled one', async () => {
    render(<OrdersListContent />);
    await waitFor(() => expect(screen.getByText('#1001')).toBeTruthy());

    fireEvent.click(tabButton('Nuevos'));
    await waitFor(() => expect(screen.getByText('#1001')).toBeTruthy());
    expect(screen.queryByText('#1002')).toBeNull();
  });

  test('"Revisar" tab lists the cancelled order with a condition badge', async () => {
    render(<OrdersListContent />);
    await waitFor(() => expect(screen.getByText('#1001')).toBeTruthy());

    fireEvent.click(tabButton('Revisar'));
    await waitFor(() => expect(screen.getByText('#1002')).toBeTruthy());
    expect(screen.queryByText('#1001')).toBeNull();
    // Condition badge surfaced (cancelled is most-severe → rendered).
    expect(screen.getByText('Cancelado')).toBeTruthy();
  });

  test('"Todos" tab shows every order', async () => {
    render(<OrdersListContent />);
    await waitFor(() => expect(screen.getByText('#1001')).toBeTruthy());
    // default tab is Todos
    expect(screen.getByText('#1001')).toBeTruthy();
    expect(screen.getByText('#1002')).toBeTruthy();
  });
});
