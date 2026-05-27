import type { CategoryType } from './customization-types';

/**
 * Two ways a Mosaiko product can be purchased:
 *
 * - `'as-is'`: the customer buys the exact design shown. Studio +
 *   Arte are licensed pre-rendered artworks; the cart line carries no
 *   user-uploaded photo, the price is fixed, and the print pipeline
 *   skips photo processing.
 *
 * - `'layout-example'`: the displayed product is *inspiration*, not a
 *   purchasable design. The card / detail page exists to communicate
 *   what a given layout looks like; the primary action takes the
 *   customer into the builder with that category + grid pre-selected
 *   so they can upload their own photo(s).
 *
 * This contract is category-level on purpose. Mixing modes inside a
 * single category was the bug that prompted this refactor — see
 * `~/.claude/plans/cheerful-knitting-swing.md` "UAT Iteration 1".
 */
export type PurchaseMode = 'as-is' | 'layout-example';

const PURCHASE_MODE_BY_CATEGORY: Record<CategoryType, PurchaseMode> = {
  studio: 'as-is',
  arte: 'as-is',
  mosaicos: 'layout-example',
  'save-the-date': 'layout-example',
  tonos: 'layout-example',
  spotify: 'layout-example',
  polaroid: 'layout-example',
};

export function getPurchaseMode(category: CategoryType): PurchaseMode {
  return PURCHASE_MODE_BY_CATEGORY[category];
}

export function isPurchasableAsIs(category: CategoryType): boolean {
  return getPurchaseMode(category) === 'as-is';
}

export function isLayoutExample(category: CategoryType): boolean {
  return getPurchaseMode(category) === 'layout-example';
}
