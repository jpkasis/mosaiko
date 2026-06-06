import { shopifyAdminFetch } from '../client';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface AdminOrder {
  id: string;
  name: string;
  orderNumber: number;
  createdAt: string;
  displayFinancialStatus: string;
  displayFulfillmentStatus: string;
  /** ISO timestamp set by Shopify when the order is cancelled, else null. */
  cancelledAt: string | null;
  /** Shopify cancel reason enum (CUSTOMER, FRAUD, INVENTORY, …) or null. */
  cancelReason: string | null;
  /** Refund records + their transactions (used to flag pending refunds). */
  refunds: {
    id: string;
    transactions: {
      edges: {
        node: { kind: string; status: string };
      }[];
    };
  }[];
  email: string;
  totalPriceSet: {
    shopMoney: { amount: string; currencyCode: string };
  };
  customer: {
    firstName: string | null;
    lastName: string | null;
  } | null;
  shippingAddress: {
    address1: string | null;
    address2: string | null;
    city: string | null;
    province: string | null;
    zip: string | null;
    country: string | null;
  } | null;
  lineItems: {
    edges: {
      node: {
        id: string;
        title: string;
        quantity: number;
        customAttributes: { key: string; value: string }[];
        image: { url: string; altText: string | null } | null;
        variant: {
          title: string;
          price: string;
        } | null;
      };
    }[];
  };
  metafields: {
    edges: {
      node: {
        namespace: string;
        key: string;
        value: string;
      };
    }[];
  };
}

// ─── Queries ────────────────────────────────────────────────────────────────

export const ORDERS_QUERY = /* GraphQL */ `
  query GetOrders($first: Int!, $query: String) {
    orders(first: $first, query: $query, sortKey: CREATED_AT, reverse: true) {
      edges {
        node {
          id
          name
          orderNumber: number
          createdAt
          displayFinancialStatus
          displayFulfillmentStatus
          cancelledAt
          cancelReason
          refunds(first: 10) {
            id
            transactions(first: 10) {
              edges {
                node {
                  kind
                  status
                }
              }
            }
          }
          email
          totalPriceSet {
            shopMoney {
              amount
              currencyCode
            }
          }
          customer {
            firstName
            lastName
          }
          lineItems(first: 10) {
            edges {
              node {
                id
                title
                quantity
                customAttributes {
                  key
                  value
                }
                image {
                  url
                  altText
                }
                variant {
                  title
                  price
                }
              }
            }
          }
          metafields(first: 5, namespace: "mosaiko") {
            edges {
              node {
                namespace
                key
                value
              }
            }
          }
        }
      }
    }
  }
`;

export const ORDER_BY_ID_QUERY = /* GraphQL */ `
  query GetOrderById($id: ID!) {
    order(id: $id) {
      id
      name
      orderNumber: number
      createdAt
      displayFinancialStatus
      displayFulfillmentStatus
      cancelledAt
      cancelReason
      refunds(first: 10) {
        id
        transactions(first: 10) {
          edges {
            node {
              kind
              status
            }
          }
        }
      }
      email
      totalPriceSet {
        shopMoney {
          amount
          currencyCode
        }
      }
      customer {
        firstName
        lastName
      }
      shippingAddress {
        address1
        address2
        city
        province
        zip
        country
      }
      lineItems(first: 20) {
        edges {
          node {
            id
            title
            quantity
            customAttributes {
              key
              value
            }
            image {
              url
              altText
            }
            variant {
              title
              price
            }
          }
        }
      }
      metafields(first: 10, namespace: "mosaiko") {
        edges {
          node {
            namespace
            key
            value
          }
        }
      }
    }
  }
`;

// ─── Functions ──────────────────────────────────────────────────────────────

export async function getOrders(first = 50, statusFilter?: string): Promise<AdminOrder[]> {
  const query = statusFilter ? `fulfillment_status:${statusFilter}` : undefined;

  const data = await shopifyAdminFetch<{
    orders: { edges: { node: AdminOrder }[] };
  }>({
    query: ORDERS_QUERY,
    variables: { first, query },
    options: { cache: 'no-store' },
  });

  return data.orders.edges.map((edge) => edge.node);
}

export async function getOrderById(id: string): Promise<AdminOrder | null> {
  const data = await shopifyAdminFetch<{
    order: AdminOrder | null;
  }>({
    query: ORDER_BY_ID_QUERY,
    variables: { id },
    options: { cache: 'no-store' },
  });

  return data.order;
}

// ─── Helper: extract metafield value ─────────────────────────────────────────

export function getMetafieldValue(order: AdminOrder, key: string): string | null {
  const metafield = order.metafields.edges.find(
    (edge) => edge.node.key === key,
  );
  return metafield?.node.value ?? null;
}

// ─── Helper: get order status from metafield ─────────────────────────────────

export type OrderStatus = 'nuevo' | 'imprimiendo' | 'enviado' | 'entregado';

export function getOrderStatus(order: AdminOrder): OrderStatus {
  const status = getMetafieldValue(order, 'fulfillment_status');
  if (status && ['nuevo', 'imprimiendo', 'enviado', 'entregado'].includes(status)) {
    return status as OrderStatus;
  }
  return 'nuevo';
}

// ─── Cancellation / refund signals (ADDITIVE overlay) ────────────────────────
//
// `getOrderStatus` above maps the print-pipeline metafield only. It has no
// notion of an order the client cancelled or refunded directly in Shopify.
// These signals derive that state from Shopify's own cancellation + financial
// fields so the admin queue can flag (and de-prioritize) such orders WITHOUT
// touching the pipeline status.

export type OrderSignal =
  | 'cancelled'
  | 'refunded'
  | 'partiallyRefunded'
  | 'refundPending'
  | 'voided'
  | 'unpaid';

// Refund-transaction statuses that mean "a refund is in flight but not yet
// settled". A pending refund leaves the order actionable (it may still
// resolve to FAILURE) but we surface it so the admin can verify first.
const PENDING_REFUND_STATUSES = new Set(['PENDING', 'AWAITING_RESPONSE', 'UNKNOWN']);

/**
 * Derives the set of cancellation/refund signals for an order from Shopify's
 * native fields (`cancelledAt`, `displayFinancialStatus`, `refunds`). Returns
 * a deduped list; an empty array means the order has no special condition.
 */
export function getOrderSignals(order: AdminOrder): OrderSignal[] {
  const signals = new Set<OrderSignal>();

  if (order.cancelledAt) {
    signals.add('cancelled');
  }

  switch (order.displayFinancialStatus) {
    case 'REFUNDED':
      signals.add('refunded');
      break;
    case 'PARTIALLY_REFUNDED':
      signals.add('partiallyRefunded');
      break;
    case 'VOIDED':
      signals.add('voided');
      break;
    // Not paid in full → not ready to print/fulfill. PENDING is the normal
    // OXXO/SPEI "awaiting payment" state; EXPIRED means the payment window
    // lapsed. (The print pipeline only runs on ORDERS_PAID, so these have no
    // print files anyway — keep them out of the actionable queue.)
    case 'PENDING':
    case 'AUTHORIZED':
    case 'PARTIALLY_PAID':
    case 'EXPIRED':
      signals.add('unpaid');
      break;
    default:
      break;
  }

  const hasPendingRefund = (order.refunds ?? []).some((refund) =>
    (refund.transactions?.edges ?? []).some(
      (edge) =>
        edge.node.kind === 'REFUND' &&
        PENDING_REFUND_STATUSES.has(edge.node.status),
    ),
  );
  if (hasPendingRefund) {
    signals.add('refundPending');
  }

  return Array.from(signals);
}

/**
 * Whether an order should remain in the actionable print queue. Cancelled,
 * fully-refunded, and voided orders are NOT actionable. Partially-refunded
 * and refund-pending orders ARE still actionable (just flagged for review).
 */
export function isOrderActionable(order: AdminOrder): boolean {
  const signals = getOrderSignals(order);
  return !(
    signals.includes('cancelled') ||
    signals.includes('refunded') ||
    signals.includes('voided') ||
    signals.includes('unpaid')
  );
}
