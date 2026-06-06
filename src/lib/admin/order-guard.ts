import { getOrderById, isOrderActionable } from '@/lib/shopify/queries/orders';

// ─── Server-side cancellation/refund guard ───────────────────────────────────
//
// Reconciles the detail page's "warn-but-allow" UX with a real server guard.
// The admin UI lets an operator advance status / download print files for a
// cancelled-or-refunded order, but only after a confirm dialog that forwards
// an explicit `confirm` flag. This guard re-reads the order LIVE from Shopify
// (getOrderById uses cache:'no-store') and blocks the mutation/processing when
// the order is NOT actionable AND no confirm was supplied.
//
// Shape mirrors the codebase's fail-closed union pattern (see print-files):
//   { ok: true }                       → proceed
//   { ok: false, status, body }        → return NextResponse.json(body, { status })

export const ORDER_NOT_PROCESSABLE_RESPONSE = {
  error: { code: 'order_not_processable' as const },
};

// Couldn't verify the order against Shopify (transient read failure). We fail
// CLOSED — better to make the operator retry than to mutate/process an order we
// can't confirm is still actionable (Codex audit).
export const ORDER_CHECK_UNAVAILABLE_RESPONSE = {
  error: { code: 'order_check_unavailable' as const },
};

export type OrderGuardResult =
  | { ok: true }
  | { ok: false; status: number; body: { error: { code: string } } };

/**
 * @param numericOrderId Shopify numeric order id (no `gid://` prefix).
 * @param confirmed      Whether the request carried an explicit confirm flag.
 *
 * Returns `{ ok: true }` when the order is actionable OR the caller confirmed.
 * Returns a 409 directive when the order is non-actionable and unconfirmed.
 *
 * A confirmed request always proceeds (explicit operator override). Otherwise
 * we re-read the order: a read EXCEPTION fails CLOSED (503) so we never
 * mutate/process an order we couldn't verify; a not-found (deleted) order is
 * left to the route's own 404 handling.
 */
export async function guardOrderActionable(
  numericOrderId: string,
  confirmed: boolean,
): Promise<OrderGuardResult> {
  if (confirmed) return { ok: true };

  let order: Awaited<ReturnType<typeof getOrderById>>;
  try {
    order = await getOrderById(`gid://shopify/Order/${numericOrderId}`);
  } catch {
    // Couldn't verify against Shopify → fail CLOSED (don't process unverified).
    return { ok: false, status: 503, body: ORDER_CHECK_UNAVAILABLE_RESPONSE };
  }

  // Order not found (deleted) → let the route's own handling deal with it.
  if (!order) return { ok: true };

  if (!isOrderActionable(order)) {
    return { ok: false, status: 409, body: ORDER_NOT_PROCESSABLE_RESPONSE };
  }

  return { ok: true };
}
