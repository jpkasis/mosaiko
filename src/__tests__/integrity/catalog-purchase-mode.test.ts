/**
 * Integrity test: catalog purchase-mode contract
 *
 * Proves the single rule that governs whether a category is sold
 * as-is (Studio, Arte) or surfaced as a layout example (everything
 * else). Future devs who add a new category must declare its mode —
 * the typed `Record<CategoryType, PurchaseMode>` in
 * `catalog-purchase-mode.ts` will fail to typecheck otherwise.
 *
 * If this test fails, someone changed the business rule without
 * updating the UAT-1 documentation. Don't silently flip an entry —
 * surface the change to the merchant first.
 */
import { describe, test, expect } from 'vitest';
import { getPurchaseMode, isPurchasableAsIs, isLayoutExample } from '@/lib/catalog-purchase-mode';
import type { CategoryType } from '@/lib/customization-types';

const ALL_CATEGORIES: CategoryType[] = [
  'mosaicos',
  'spotify',
  'tonos',
  'save-the-date',
  'arte',
  'studio',
  'polaroid',
];

const AS_IS_CATEGORIES: CategoryType[] = ['studio', 'arte'];
const LAYOUT_EXAMPLE_CATEGORIES: CategoryType[] = [
  'mosaicos',
  'spotify',
  'tonos',
  'save-the-date',
  'polaroid',
];

describe('catalog purchase-mode contract', () => {
  test('every CategoryType resolves to a defined purchase mode', () => {
    for (const cat of ALL_CATEGORIES) {
      const mode = getPurchaseMode(cat);
      expect(mode === 'as-is' || mode === 'layout-example').toBe(true);
    }
  });

  test('exactly Studio + Arte are as-is', () => {
    for (const cat of AS_IS_CATEGORIES) {
      expect(getPurchaseMode(cat)).toBe('as-is');
      expect(isPurchasableAsIs(cat)).toBe(true);
      expect(isLayoutExample(cat)).toBe(false);
    }
  });

  test('all other categories are layout-example', () => {
    for (const cat of LAYOUT_EXAMPLE_CATEGORIES) {
      expect(getPurchaseMode(cat)).toBe('layout-example');
      expect(isLayoutExample(cat)).toBe(true);
      expect(isPurchasableAsIs(cat)).toBe(false);
    }
  });

  test('AS_IS and LAYOUT_EXAMPLE sets partition all categories', () => {
    const union = [...AS_IS_CATEGORIES, ...LAYOUT_EXAMPLE_CATEGORIES].sort();
    const all = [...ALL_CATEGORIES].sort();
    expect(union).toEqual(all);
    expect(AS_IS_CATEGORIES.length + LAYOUT_EXAMPLE_CATEGORIES.length).toBe(ALL_CATEGORIES.length);
  });
});
