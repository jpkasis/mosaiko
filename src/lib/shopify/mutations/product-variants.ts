/**
 * PR-B — admin price writes. The admin "Precios" editor calls this to set
 * variant prices on the v2 pricing product. Uses `productVariantsBulkUpdate`
 * (the non-deprecated 2026-04 path; `productSet` is avoided here because its
 * list-replacement semantics would clobber omitted variants). Prices are
 * sent as decimal STRINGS per the 2026-04 schema.
 */
import { shopifyAdminFetch } from '@/lib/shopify/client';
import { ShopifyUserErrorsError } from '@/lib/shopify/mutations/metaobjects';
import { PRICING_PRODUCT_HANDLE } from '@/lib/shopify/pricing-options';

const PRICING_PRODUCT_ID_QUERY = /* GraphQL */ `
  query PricingProductId($q: String!) {
    products(first: 1, query: $q) {
      nodes { id }
    }
  }
`;

/** Admin GID of the v2 pricing product, or null if it doesn't exist yet. */
export async function getPricingProductId(): Promise<string | null> {
  const data = await shopifyAdminFetch<{ products: { nodes: { id: string }[] } }>({
    query: PRICING_PRODUCT_ID_QUERY,
    variables: { q: `handle:${PRICING_PRODUCT_HANDLE}` },
    options: { cache: 'no-store' },
  });
  return data.products.nodes[0]?.id ?? null;
}

const BULK_UPDATE_PRICES_MUTATION = /* GraphQL */ `
  mutation BulkUpdateVariantPrices($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
    productVariantsBulkUpdate(productId: $productId, variants: $variants) {
      productVariants { id price }
      userErrors { field message }
    }
  }
`;

interface BulkUpdateResponse {
  productVariantsBulkUpdate: {
    productVariants: Array<{ id: string; price: string }> | null;
    userErrors: Array<{ field?: string[] | null; message: string }>;
  };
}

export interface VariantPriceUpdate {
  variantId: string;
  /** MXN amount; serialized to a 2-decimal string for Shopify. */
  price: number;
}

/**
 * Sets prices on the given variants of the pricing product. Throws
 * `ShopifyUserErrorsError` if Shopify rejects any update (no partial writes).
 */
export async function bulkUpdateVariantPrices(
  productId: string,
  updates: VariantPriceUpdate[],
): Promise<Array<{ id: string; price: string }>> {
  if (updates.length === 0) return [];
  const variants = updates.map((u) => ({ id: u.variantId, price: u.price.toFixed(2) }));

  const data = await shopifyAdminFetch<BulkUpdateResponse>({
    query: BULK_UPDATE_PRICES_MUTATION,
    variables: { productId, variants },
    options: { cache: 'no-store' },
  });

  const { userErrors, productVariants } = data.productVariantsBulkUpdate;
  if (userErrors?.length) {
    throw new ShopifyUserErrorsError('productVariantsBulkUpdate', userErrors);
  }
  return productVariants ?? [];
}
