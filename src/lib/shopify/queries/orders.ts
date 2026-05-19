import { shopifyAdminFetch } from '../client';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface AdminOrder {
  id: string;
  name: string;
  orderNumber: number;
  createdAt: string;
  displayFinancialStatus: string;
  displayFulfillmentStatus: string;
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

const ORDERS_QUERY = /* GraphQL */ `
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

const ORDER_BY_ID_QUERY = /* GraphQL */ `
  query GetOrderById($id: ID!) {
    order(id: $id) {
      id
      name
      orderNumber: number
      createdAt
      displayFinancialStatus
      displayFulfillmentStatus
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
