import 'server-only';

import {
  PRODUCTS,
  CATALOG_CATEGORIES,
  type CatalogProduct,
} from './catalog-data';
import type { CategoryType } from './customization-types';

// ─── Async helpers (merge static + dynamic products) ────────────────────────
//
// Lives in a `.server.ts` sibling so the static import graph of
// `catalog-data.ts` stays pure-data and can be safely consumed by client
// components without dragging Sharp / Shopify Admin / storage into the
// browser bundle. Server pages call these helpers; client components
// receive the merged data via props.

export async function getAllProducts(): Promise<CatalogProduct[]> {
  try {
    const { getDynamicProducts } = await import('./admin/product-store');
    const dynamic = await getDynamicProducts();
    return [...PRODUCTS, ...dynamic];
  } catch {
    // Storage unavailable (e.g. during build) — return static only
    return [...PRODUCTS];
  }
}

export async function getAllProductsByCategory(): Promise<
  Map<CategoryType, CatalogProduct[]>
> {
  const all = await getAllProducts();
  const map = new Map<CategoryType, CatalogProduct[]>();
  for (const cat of CATALOG_CATEGORIES) {
    map.set(cat.type, []);
  }
  for (const product of all) {
    const list = map.get(product.category);
    if (list) list.push(product);
  }
  return map;
}

export async function getProductByIdAsync(
  id: string,
): Promise<CatalogProduct | undefined> {
  // Check static first (fast path)
  const staticProduct = PRODUCTS.find((p) => p.id === id);
  if (staticProduct) return staticProduct;
  // Check dynamic
  try {
    const { getDynamicProducts } = await import('./admin/product-store');
    const dynamic = await getDynamicProducts();
    return dynamic.find((p) => p.id === id);
  } catch {
    return undefined;
  }
}
