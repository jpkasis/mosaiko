import { shopifyAdminFetch } from '../client';

// ─── Update order metafield ─────────────────────────────────────────────────

const UPDATE_METAFIELD_MUTATION = /* GraphQL */ `
  mutation UpdateOrderMetafield($input: MetafieldInput!) {
    metafieldSet(metafield: $input) {
      metafield {
        id
        namespace
        key
        value
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export async function updateOrderMetafield(
  orderId: string,
  namespace: string,
  key: string,
  value: string,
): Promise<void> {
  const data = await shopifyAdminFetch<{
    metafieldSet: {
      userErrors: { field: string[]; message: string }[];
    };
  }>({
    query: UPDATE_METAFIELD_MUTATION,
    variables: {
      input: {
        ownerId: orderId,
        namespace,
        key,
        value,
        type: 'single_line_text_field',
      },
    },
    options: { cache: 'no-store' },
  });

  const errors = data.metafieldSet.userErrors;
  if (errors.length > 0) {
    throw new Error(
      `[Shopify] Failed to update metafield: ${errors.map((e) => e.message).join(', ')}`,
    );
  }
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

// ─── Create fulfillment ──────────────────────────────────────────────────────

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
  const data = await shopifyAdminFetch<{
    fulfillmentCreate: {
      userErrors: { field: string[]; message: string }[];
    };
  }>({
    query: CREATE_FULFILLMENT_MUTATION,
    variables: {
      fulfillment: {
        orderId,
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
