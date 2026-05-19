// ─── Shopify GraphQL Types ──────────────────────────────────────────────────
// Mirrors Shopify Storefront API 2026-04 schema.
// Uses edges/nodes connection pattern for paginated resources.

// ─── Primitives ─────────────────────────────────────────────────────────────

export interface ShopifyMoney {
  amount: string;
  currencyCode: string;
}

export interface ShopifyImage {
  url: string;
  altText: string | null;
  width: number;
  height: number;
}

// ─── Connection pattern ─────────────────────────────────────────────────────

export interface ShopifyEdge<T> {
  node: T;
  cursor?: string;
}

export interface ShopifyConnection<T> {
  edges: ShopifyEdge<T>[];
  pageInfo?: {
    hasNextPage: boolean;
    hasPreviousPage: boolean;
    startCursor?: string;
    endCursor?: string;
  };
}

// ─── GraphQL response wrapper ───────────────────────────────────────────────

export interface ShopifyResponse<T> {
  data: T;
  errors?: Array<{
    message: string;
    locations?: Array<{ line: number; column: number }>;
    path?: string[];
    extensions?: Record<string, unknown>;
  }>;
}

// ─── Product variant ────────────────────────────────────────────────────────

export interface ShopifySelectedOption {
  name: string;
  value: string;
}

export interface ShopifyProductVariant {
  id: string;
  title: string;
  availableForSale: boolean;
  price: ShopifyMoney;
  compareAtPrice: ShopifyMoney | null;
  selectedOptions: ShopifySelectedOption[];
  image?: ShopifyImage;
}

export interface ShopifyProductOption {
  id: string;
  name: string;
  values: string[];
}

// ─── Product ────────────────────────────────────────────────────────────────

export interface ShopifyProduct {
  id: string;
  handle: string;
  title: string;
  description: string;
  descriptionHtml: string;
  availableForSale: boolean;
  tags: string[];
  options: ShopifyProductOption[];
  priceRange: {
    minVariantPrice: ShopifyMoney;
    maxVariantPrice: ShopifyMoney;
  };
  images: ShopifyConnection<ShopifyImage>;
  variants: ShopifyConnection<ShopifyProductVariant>;
  featuredImage: ShopifyImage | null;
  seo?: {
    title: string | null;
    description: string | null;
  };
  updatedAt: string;
  createdAt: string;
}

// ─── Collection ─────────────────────────────────────────────────────────────

export interface ShopifyCollection {
  id: string;
  handle: string;
  title: string;
  description: string;
  image: ShopifyImage | null;
  seo?: {
    title: string | null;
    description: string | null;
  };
  products: ShopifyConnection<ShopifyProduct>;
  updatedAt: string;
}

// ─── Cart ───────────────────────────────────────────────────────────────────

export interface CartLineAttribute {
  key: string;
  value: string;
}

export interface ShopifyCartLineMerchandise {
  id: string;
  title: string;
  selectedOptions: ShopifySelectedOption[];
  product: {
    id: string;
    handle: string;
    title: string;
    featuredImage: ShopifyImage | null;
  };
}

export interface ShopifyCartLineItem {
  id: string;
  quantity: number;
  attributes: CartLineAttribute[];
  cost: {
    amountPerQuantity: ShopifyMoney;
    totalAmount: ShopifyMoney;
  };
  merchandise: ShopifyCartLineMerchandise;
}

export interface ShopifyCart {
  id: string;
  checkoutUrl: string;
  totalQuantity: number;
  cost: {
    subtotalAmount: ShopifyMoney;
    totalAmount: ShopifyMoney;
    totalTaxAmount: ShopifyMoney | null;
  };
  lines: ShopifyConnection<ShopifyCartLineItem>;
  attributes: CartLineAttribute[];
}

// ─── Input types (for mutations) ────────────────────────────────────────────

export interface CartLineInput {
  merchandiseId: string;
  quantity: number;
  attributes?: CartLineAttribute[];
}

export interface CartLineUpdateInput {
  id: string;
  merchandiseId?: string;
  quantity: number;
  attributes?: CartLineAttribute[];
}

// ─── Reshaped types (flattened, no edges/nodes) ─────────────────────────────
// These are what consumer code actually works with.

export type Product = Omit<ShopifyProduct, 'images' | 'variants'> & {
  images: ShopifyImage[];
  variants: ShopifyProductVariant[];
};

export type Collection = Omit<ShopifyCollection, 'products'> & {
  products: Product[];
};

export type Cart = Omit<ShopifyCart, 'lines'> & {
  lines: ShopifyCartLineItem[];
};
