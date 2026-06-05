/**
 * PR-B (Codex audit fix) — price cart lines from the LIVE matrix, not the
 * persisted `CartItem.price` (which was captured at add-to-cart time and goes
 * stale if the admin edits a price). The checkout charges the live Shopify
 * variant, so the displayed cart total must read the same source → no
 * "shows $X, charges $Y" mismatch.
 *
 * Pure helpers (no React) so the cart components compute display prices from
 * the `usePriceMap()` context. `DisplayPriceMap` is a type-only import, so
 * `prices.ts`'s `server-only` runtime never reaches the client bundle.
 */
import type { CartItem } from './cart-store';
import type { CategoryType } from './customization-types';
import { GRID_CONFIGS } from './grid-config';
import { getProductById } from './catalog-data';
import type { DisplayPriceMap } from './shopify/prices';

/** The pricing category for a cart line (custom = customization; predesigned
 *  = the trusted catalog category, never the client-supplied slug). */
export function cartItemCategory(item: CartItem): CategoryType | null {
  if (item.customizations?.categoryType) return item.customizations.categoryType;
  if (item.type === 'predesigned' && item.productId) {
    const p = getProductById(item.productId);
    if (p) return p.category as CategoryType;
  }
  return (item.categorySlug as CategoryType | undefined) ?? null;
}

/** Live unit price for a cart line: Shopify matrix → legacy size-based →
 *  stored add-time price (last resort). */
export function cartItemUnitPrice(map: DisplayPriceMap, item: CartItem): number {
  const category = cartItemCategory(item);
  const live = category ? map[category]?.[item.gridSize] : undefined;
  if (live != null) return live;
  // The single tile (size 1) is v2-only with a freely-set price — never
  // synthesize a GRID_CONFIGS default for it; use the stored add-time price.
  if (item.gridSize === 1) return item.price;
  return GRID_CONFIGS[item.gridSize]?.price ?? item.price;
}

/** Cart total at live prices (× quantity). */
export function cartLiveTotal(map: DisplayPriceMap, items: CartItem[]): number {
  return items.reduce((sum, item) => sum + cartItemUnitPrice(map, item) * item.quantity, 0);
}
