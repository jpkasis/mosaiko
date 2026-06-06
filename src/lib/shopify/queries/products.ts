import { shopifyFetch } from '../client';
import { reshapeProduct, reshapeProducts, flattenConnection } from '../reshape';
import type { ShopifyProduct, ShopifyConnection, Product } from '../types';

// ─── Fragments ──────────────────────────────────────────────────────────────

const PRODUCT_FRAGMENT = /* GraphQL */ `
  fragment ProductFields on Product {
    id
    handle
    title
    description
    descriptionHtml
    availableForSale
    tags
    createdAt
    updatedAt
    options {
      id
      name
      values
    }
    priceRange {
      minVariantPrice {
        amount
        currencyCode
      }
      maxVariantPrice {
        amount
        currencyCode
      }
    }
    featuredImage {
      url
      altText
      width
      height
    }
    seo {
      title
      description
    }
    images(first: 20) {
      edges {
        node {
          url
          altText
          width
          height
        }
      }
    }
    variants(first: 100) {
      edges {
        node {
          id
          title
          availableForSale
          price {
            amount
            currencyCode
          }
          compareAtPrice {
            amount
            currencyCode
          }
          selectedOptions {
            name
            value
          }
          image {
            url
            altText
            width
            height
          }
        }
      }
    }
  }
`;

// ─── Queries ────────────────────────────────────────────────────────────────

const GET_PRODUCTS_QUERY = /* GraphQL */ `
  ${PRODUCT_FRAGMENT}
  query GetProducts($first: Int = 100, $sortKey: ProductSortKeys = BEST_SELLING) {
    products(first: $first, sortKey: $sortKey) {
      edges {
        node {
          ...ProductFields
        }
      }
    }
  }
`;

const GET_PRODUCT_BY_HANDLE_QUERY = /* GraphQL */ `
  ${PRODUCT_FRAGMENT}
  query GetProductByHandle($handle: String!) {
    product(handle: $handle) {
      ...ProductFields
    }
  }
`;

const GET_PRODUCT_RECOMMENDATIONS_QUERY = /* GraphQL */ `
  ${PRODUCT_FRAGMENT}
  query GetProductRecommendations($productId: ID!) {
    productRecommendations(productId: $productId) {
      ...ProductFields
    }
  }
`;

// ─── Fetchers ───────────────────────────────────────────────────────────────

/**
 * Fetches all products from the store.
 */
export async function getProducts(first: number = 100): Promise<Product[]> {
  const data = await shopifyFetch<{
    products: ShopifyConnection<ShopifyProduct>;
  }>({
    query: GET_PRODUCTS_QUERY,
    variables: { first },
    options: {
      next: { revalidate: 120, tags: ['products'] },
    },
  });

  return reshapeProducts(flattenConnection(data.products));
}

/**
 * Fetches a single product by its handle (URL slug).
 */
export async function getProductByHandle(
  handle: string
): Promise<Product | null> {
  const data = await shopifyFetch<{
    product: ShopifyProduct | null;
  }>({
    query: GET_PRODUCT_BY_HANDLE_QUERY,
    variables: { handle },
    options: {
      next: { revalidate: 120, tags: ['products', `product-${handle}`] },
    },
  });

  if (!data.product) return null;
  return reshapeProduct(data.product);
}

/**
 * Fetches recommended products for a given product ID.
 */
export async function getProductRecommendations(
  productId: string
): Promise<Product[]> {
  const data = await shopifyFetch<{
    productRecommendations: ShopifyProduct[];
  }>({
    query: GET_PRODUCT_RECOMMENDATIONS_QUERY,
    variables: { productId },
    options: {
      next: { revalidate: 120, tags: ['products'] },
    },
  });

  return reshapeProducts(data.productRecommendations);
}
