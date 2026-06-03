/**
 * Shop-owner metafield writes (UAT-6 PR4).
 *
 * Used to persist the admin password hash override at
 * mosaiko_admin/password_hash so the client can change their password
 * without a developer touching env vars / redeploying.
 *
 * Reuses the same `metafieldsSet` mutation the order pipeline uses, but
 * with `ownerId` = the Shop GID (from getShopId()).
 */
import { shopifyAdminFetch } from '@/lib/shopify/client';
import { ShopifyUserErrorsError } from '@/lib/shopify/mutations/metaobjects';

export const METAFIELDS_SET_MUTATION = /* GraphQL */ `
  mutation MetafieldsSet($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      metafields {
        id
        namespace
        key
      }
      userErrors {
        field
        message
      }
    }
  }
`;

interface MetafieldsSetResponse {
  metafieldsSet: {
    metafields: Array<{ id: string; namespace: string; key: string }> | null;
    userErrors: Array<{ field?: string[] | null; message: string }>;
  };
}

/**
 * Writes a single Shop-owner metafield. `type` defaults to
 * `single_line_text_field`. Throws `ShopifyUserErrorsError` if Shopify
 * rejects the write.
 */
export async function setShopMetafield(
  shopId: string,
  namespace: string,
  key: string,
  value: string,
  type = 'single_line_text_field',
): Promise<void> {
  const data = await shopifyAdminFetch<MetafieldsSetResponse>({
    query: METAFIELDS_SET_MUTATION,
    variables: {
      metafields: [{ ownerId: shopId, namespace, key, value, type }],
    },
    options: { cache: 'no-store' },
  });
  const errors = data.metafieldsSet.userErrors;
  if (errors.length > 0) {
    throw new ShopifyUserErrorsError('metafieldsSet', errors);
  }
}
