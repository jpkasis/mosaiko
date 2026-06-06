/**
 * PR-B — admin price writes. The admin "Precios" editor calls this to set
 * variant prices on the v2 pricing product. Uses `productVariantsBulkUpdate`
 * (the non-deprecated 2026-04 path; `productSet` is avoided here because its
 * list-replacement semantics would clobber omitted variants). Prices are
 * sent as decimal STRINGS per the 2026-04 schema.
 */
import { shopifyAdminFetch } from '@/lib/shopify/client';
import { ShopifyUserErrorsError } from '@/lib/shopify/mutations/metaobjects';
import {
  PRICING_PRODUCT_HANDLE,
  CATEGORY_OPTION_NAME,
  SIZE_OPTION_NAME,
  categoryFromOptionValue,
  sizeFromOptionValue,
} from '@/lib/shopify/pricing-options';
import type { CategoryType } from '@/lib/customization-types';
import type { GridSize } from '@/lib/grid-config';

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

export interface AdminPriceCell {
  price: number;
  variantId: string;
}
export type AdminPriceMatrix = Partial<
  Record<CategoryType, Partial<Record<GridSize, AdminPriceCell>>>
>;

const ADMIN_PRICE_MATRIX_QUERY = /* GraphQL */ `
  query AdminPriceMatrix($q: String!) {
    products(first: 1, query: $q) {
      nodes {
        id
        variants(first: 100) {
          nodes { id price selectedOptions { name value } }
        }
      }
    }
  }
`;

/**
 * Reads the v2 pricing product's variant prices via the ADMIN API — strongly
 * consistent (no Storefront propagation lag, no `unstable_cache`). The admin
 * "Precios" editor uses this so a just-saved price shows immediately, instead
 * of the cached/eventually-consistent Storefront read that made saves appear
 * to "revert". Returns the product GID (for variant writes) + the matrix.
 */
export async function getAdminPriceMatrix(): Promise<{
  productId: string | null;
  matrix: AdminPriceMatrix;
}> {
  const data = await shopifyAdminFetch<{
    products: {
      nodes: Array<{
        id: string;
        variants: {
          nodes: Array<{
            id: string;
            price: string;
            selectedOptions: { name: string; value: string }[];
          }>;
        };
      }>;
    };
  }>({
    query: ADMIN_PRICE_MATRIX_QUERY,
    variables: { q: `handle:${PRICING_PRODUCT_HANDLE}` },
    options: { cache: 'no-store' },
  });

  const product = data.products.nodes[0];
  if (!product) return { productId: null, matrix: {} };

  const matrix: AdminPriceMatrix = {};
  for (const v of product.variants.nodes) {
    let category: CategoryType | null = null;
    let gridSize: GridSize | null = null;
    for (const opt of v.selectedOptions) {
      if (opt.name === CATEGORY_OPTION_NAME) category = categoryFromOptionValue(opt.value);
      if (opt.name === SIZE_OPTION_NAME) gridSize = sizeFromOptionValue(opt.value);
    }
    const price = Number.parseFloat(v.price);
    if (!category || gridSize == null || !Number.isFinite(price)) continue;
    (matrix[category] ??= {})[gridSize] = { price, variantId: v.id };
  }
  return { productId: product.id, matrix };
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
