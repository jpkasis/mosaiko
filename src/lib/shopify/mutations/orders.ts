import { shopifyAdminFetch } from '../client';

// ─── Order GID coercion ─────────────────────────────────────────────────────

/**
 * Accept either a numeric REST id (`'12345'`) or a fully-qualified
 * Shopify GID. Mutations require the GID form; admin REST routes
 * receive the numeric form from the URL. Centralise the coercion so
 * future call sites can't pass the wrong shape silently.
 */
function toOrderGid(orderId: string): string {
  return orderId.startsWith('gid://shopify/Order/')
    ? orderId
    : `gid://shopify/Order/${orderId}`;
}

// ─── Update a single order metafield ────────────────────────────────────────
//
// Codex audit (high): the prior implementation used the deprecated
// singular `metafieldSet` mutation AND passed a numeric REST id as the
// owner GID. We now delegate to `setOrderMetafields` (plural — the
// modern atomic upsert) and coerce the id to a GID first.

export async function updateOrderMetafield(
  orderId: string,
  namespace: string,
  key: string,
  value: string,
): Promise<void> {
  await setOrderMetafields(toOrderGid(orderId), [
    { namespace, key, value, type: 'single_line_text_field' },
  ]);
}

// ─── Batched metafield upsert ───────────────────────────────────────────────

/**
 * `metafieldsSet` (plural) atomically creates OR updates up to 25
 * metafields in one call. Unlike the REST `POST .../metafields.json`
 * endpoint — which always creates a new row and accumulates
 * duplicates on repeated writes of the same (namespace, key) — this
 * mutation is a true upsert, so the per-order pipeline metafields
 * (print_pipeline_status, print_pipeline_results, print_files,
 * print_pipeline_errors) stay single-row and consistent across
 * retries.
 *
 * All metafields are applied in one transaction: either every write
 * lands (userErrors empty) or the whole batch is rejected. This
 * eliminates the write-order bug where status='complete' could be
 * committed before the corresponding print_files URL set.
 */
const METAFIELDS_SET_MUTATION = /* GraphQL */ `
  mutation MetafieldsSet($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      metafields {
        id
        key
        namespace
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export interface OrderMetafieldWrite {
  namespace: string;
  key: string;
  value: string;
  type:
    | 'json'
    | 'single_line_text_field'
    | 'multi_line_text_field'
    | 'number_integer';
}

/**
 * Write (atomically upsert) multiple metafields on a single order.
 *
 * @param orderGid  Shopify global ID (e.g. `gid://shopify/Order/12345`).
 * @param metafields  Array of namespace/key/value/type tuples.
 */
export async function setOrderMetafields(
  orderGid: string,
  metafields: OrderMetafieldWrite[],
): Promise<void> {
  if (metafields.length === 0) return;

  const data = await shopifyAdminFetch<{
    metafieldsSet: {
      userErrors: { field: string[]; message: string }[];
    };
  }>({
    query: METAFIELDS_SET_MUTATION,
    variables: {
      metafields: metafields.map((mf) => ({
        ownerId: orderGid,
        namespace: mf.namespace,
        key: mf.key,
        value: mf.value,
        type: mf.type,
      })),
    },
    options: { cache: 'no-store' },
  });

  const errors = data.metafieldsSet.userErrors;
  if (errors.length > 0) {
    throw new Error(
      `[Shopify] metafieldsSet failed: ${errors
        .map((e) => `${e.field?.join('.') ?? ''}: ${e.message}`)
        .join(', ')}`,
    );
  }
}

// ─── Order tags ─────────────────────────────────────────────────────────────
//
// Failure visibility lives on order tags rather than email blasts: a
// `print-pipeline-failed` or `print-pipeline-partial` tag makes the
// affected orders surface naturally in Shopify Admin's order list (which
// supports filtering by tag), and on the local admin panel as a
// "Fallidos" badge — no per-error email noise. On retry success the
// tags are removed by the retry route.

const TAGS_ADD_MUTATION = /* GraphQL */ `
  mutation TagsAdd($id: ID!, $tags: [String!]!) {
    tagsAdd(id: $id, tags: $tags) {
      node { id }
      userErrors { field message }
    }
  }
`;

const TAGS_REMOVE_MUTATION = /* GraphQL */ `
  mutation TagsRemove($id: ID!, $tags: [String!]!) {
    tagsRemove(id: $id, tags: $tags) {
      node { id }
      userErrors { field message }
    }
  }
`;

export async function addOrderTags(
  orderGid: string,
  tags: string[],
): Promise<void> {
  if (tags.length === 0) return;
  const data = await shopifyAdminFetch<{
    tagsAdd: { userErrors: { field: string[]; message: string }[] };
  }>({
    query: TAGS_ADD_MUTATION,
    variables: { id: orderGid, tags },
    options: { cache: 'no-store' },
  });
  const errors = data.tagsAdd.userErrors;
  if (errors.length > 0) {
    throw new Error(
      `[Shopify] tagsAdd failed: ${errors.map((e) => e.message).join(', ')}`,
    );
  }
}

export async function removeOrderTags(
  orderGid: string,
  tags: string[],
): Promise<void> {
  if (tags.length === 0) return;
  const data = await shopifyAdminFetch<{
    tagsRemove: { userErrors: { field: string[]; message: string }[] };
  }>({
    query: TAGS_REMOVE_MUTATION,
    variables: { id: orderGid, tags },
    options: { cache: 'no-store' },
  });
  const errors = data.tagsRemove.userErrors;
  if (errors.length > 0) {
    throw new Error(
      `[Shopify] tagsRemove failed: ${errors.map((e) => e.message).join(', ')}`,
    );
  }
}

// ─── Create fulfillment (2026-04 schema) ────────────────────────────────────
//
// Codex audit (high): the 2026-04 `FulfillmentInput` no longer accepts
// `orderId`. Fulfillments are now created against one or more
// `FulfillmentOrder` records that Shopify auto-generates per order.
//
// The two-step flow:
//   1. Query the order's fulfillment orders, keep the ones still
//      eligible to fulfill (status !== CLOSED).
//   2. Call `fulfillmentCreate` with `lineItemsByFulfillmentOrder`
//      pointing at each fulfillment-order GID. Omitting
//      `fulfillmentOrderLineItems` fulfills every line on each FO.
//
// `notifyCustomer: true` makes Shopify send the native shipping email,
// which is what replaced the Resend `sendShippingNotification` call.

const ORDER_FULFILLMENT_ORDERS_QUERY = /* GraphQL */ `
  query OrderFulfillmentOrders($id: ID!) {
    order(id: $id) {
      id
      fulfillmentOrders(first: 25) {
        edges {
          node {
            id
            status
          }
        }
      }
    }
  }
`;

const CREATE_FULFILLMENT_MUTATION = /* GraphQL */ `
  mutation CreateFulfillment($fulfillment: FulfillmentInput!) {
    fulfillmentCreate(fulfillment: $fulfillment) {
      fulfillment {
        id
        status
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export async function createFulfillment(
  orderId: string,
  trackingNumber: string,
  trackingCompany?: string,
): Promise<void> {
  const orderGid = toOrderGid(orderId);

  // 1. Look up the order's fulfillment orders.
  const foData = await shopifyAdminFetch<{
    order: {
      fulfillmentOrders: {
        edges: Array<{ node: { id: string; status: string } }>;
      };
    } | null;
  }>({
    query: ORDER_FULFILLMENT_ORDERS_QUERY,
    variables: { id: orderGid },
    options: { cache: 'no-store' },
  });

  if (!foData.order) {
    throw new Error(
      `[Shopify] createFulfillment: order ${orderGid} not found`,
    );
  }
  const eligible = foData.order.fulfillmentOrders.edges
    .map((e) => e.node)
    .filter((n) => n.status !== 'CLOSED' && n.status !== 'CANCELLED');
  if (eligible.length === 0) {
    throw new Error(
      `[Shopify] createFulfillment: no eligible fulfillment orders on ${orderGid}`,
    );
  }

  // 2. Fulfill each eligible FO completely. Tracking info on each.
  const data = await shopifyAdminFetch<{
    fulfillmentCreate: {
      userErrors: { field: string[]; message: string }[];
    };
  }>({
    query: CREATE_FULFILLMENT_MUTATION,
    variables: {
      fulfillment: {
        lineItemsByFulfillmentOrder: eligible.map((fo) => ({
          fulfillmentOrderId: fo.id,
        })),
        trackingInfo: {
          number: trackingNumber,
          company: trackingCompany || 'Otro',
        },
        notifyCustomer: true,
      },
    },
    options: { cache: 'no-store' },
  });

  const errors = data.fulfillmentCreate.userErrors;
  if (errors.length > 0) {
    throw new Error(
      `[Shopify] Failed to create fulfillment: ${errors.map((e) => e.message).join(', ')}`,
    );
  }
}
