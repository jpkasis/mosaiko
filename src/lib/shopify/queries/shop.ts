/**
 * Shop-level queries: the Shop's own GID + arbitrary Shop metafields.
 *
 * Used by UAT-6 PR4:
 *   - getShopId() resolves the `gid://shopify/Shop/...` owner id needed to
 *     write Shop-owner metafields (admin password hash).
 *   - getShopMetafield() reads a single Shop metafield by namespace/key
 *     (the admin password hash override lives at mosaiko_admin/password_hash).
 */
import { shopifyAdminFetch } from '@/lib/shopify/client';

export const SHOP_ID_QUERY = /* GraphQL */ `
  query ShopId {
    shop {
      id
    }
  }
`;

export const SHOP_METAFIELD_QUERY = /* GraphQL */ `
  query ShopMetafield($namespace: String!, $key: String!) {
    shop {
      metafield(namespace: $namespace, key: $key) {
        id
        namespace
        key
        type
        value
      }
    }
  }
`;

interface ShopIdResponse {
  shop: { id: string };
}

interface ShopMetafieldResponse {
  shop: {
    metafield: {
      id: string;
      namespace: string;
      key: string;
      type: string;
      value: string | null;
    } | null;
  };
}

/**
 * Returns the Shop's GID (e.g. `gid://shopify/Shop/12345`). Throws on
 * Shopify error (auth, network). Cached in module memory for the lifetime
 * of the function instance — the Shop GID never changes.
 */
let cachedShopId: string | null = null;

export async function getShopId(): Promise<string> {
  if (cachedShopId) return cachedShopId;
  const data = await shopifyAdminFetch<ShopIdResponse>({
    query: SHOP_ID_QUERY,
    options: { cache: 'no-store' },
  });
  cachedShopId = data.shop.id;
  return cachedShopId;
}

/**
 * Reads a single Shop metafield value by namespace/key. Returns `null`
 * when the metafield doesn't exist. Throws on Shopify error so callers
 * can fail closed (e.g. the admin-auth password lookup must NOT silently
 * fall back to the env hash on a Shopify outage).
 */
export async function getShopMetafield(
  namespace: string,
  key: string,
): Promise<string | null> {
  const data = await shopifyAdminFetch<ShopMetafieldResponse>({
    query: SHOP_METAFIELD_QUERY,
    variables: { namespace, key },
    options: { cache: 'no-store' },
  });
  return data.shop.metafield?.value ?? null;
}
