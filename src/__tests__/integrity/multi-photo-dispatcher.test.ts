/**
 * UAT-3 Phase 3 contract test: multi-photo dispatch derives from the
 * layout contract (`isMultiPhotoInput`), not from literal category
 * string checks.
 *
 * Findings locked by this test:
 *   - E9 (`src/lib/shopify/checkout.ts`): cart attrs decision
 *   - E10 (`src/components/builder/MagnetPreview.tsx`): preview decision
 *   - E8 (`src/app/api/generate-print/route.ts`): generate-print dispatch
 *
 * Why: STD-9, STD-6 are single-photo; STD-3 is multi-photo; Tonos is
 * always multi-photo. The literal `category === 'tonos'` branches in
 * the route/preview/cart code path missed STD-3 entirely. Codex's
 * audit flagged this as the next ENOENT-class bug waiting to surface
 * once a real customer reached the STD-3 generate-print path. The fix
 * threads `isMultiPhotoInput(layout, gridSize)` through every decision
 * site so STD-3 (and any future category-grid combination) gets
 * routed correctly without further code change.
 */
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { isMultiPhotoInput } from '@/lib/category-layouts/derive';
import { CATEGORY_LAYOUTS } from '@/lib/category-layouts';
import { buildCartLines } from '@/lib/shopify/checkout';
import type { CartItem } from '@/lib/cart-store';
import type { GridSize } from '@/lib/grid-config';
import type { CategoryType } from '@/lib/customization-types';

beforeEach(() => {
  vi.stubEnv(
    'SHOPIFY_VARIANT_MAP',
    JSON.stringify({
      '3': 'gid://shopify/ProductVariant/100',
      '4': 'gid://shopify/ProductVariant/101',
      '6': 'gid://shopify/ProductVariant/102',
      '9': 'gid://shopify/ProductVariant/103',
    }),
  );
});

// ─── Layout contract — multi-photo map ──────────────────────────────────────

describe('isMultiPhotoInput — the single source of truth', () => {
  type Case = readonly [CategoryType, GridSize, boolean];

  // Every (category, grid) combo the catalog allows + expected multi-photo
  // flag. STD-3 is multi, STD-6/9 single, Tonos always multi, the rest single.
  const CASES: ReadonlyArray<Case> = [
    ['mosaicos', 3, false],
    ['mosaicos', 6, false],
    ['mosaicos', 9, false],
    ['studio', 6, false],
    ['arte', 9, false],
    ['save-the-date', 3, true], // multi
    ['save-the-date', 6, false],
    ['save-the-date', 9, false],
    ['tonos', 3, true], // multi
    ['tonos', 9, true], // multi
    ['spotify', 6, false],
    ['polaroid', 4, false],
  ];

  test.each(CASES)(
    'isMultiPhotoInput(%s, %d) === %s',
    (category, grid, expected) => {
      const layout = CATEGORY_LAYOUTS[category];
      expect(isMultiPhotoInput(layout, grid)).toBe(expected);
    },
  );
});

// ─── E9 contract — checkout cart attrs ──────────────────────────────────────

describe('Checkout cart attributes derive multi-photo flag from isMultiPhotoInput (UAT-3 E9)', () => {
  function makeItem(overrides: Partial<CartItem>): CartItem {
    return {
      id: 'item-1',
      productId: 'custom-1',
      name: 'Test',
      gridSize: 9,
      gridLayout: { rows: 3, cols: 3 },
      price: 480,
      quantity: 1,
      previewUrl: 'https://cdn.shopify.com/test.png',
      tileUrls: [],
      customizations: {
        categoryType: 'mosaicos',
        photoStorageUrl: 'https://cdn.shopify.com/x.jpg',
        cropArea: { x: 0, y: 0, width: 100, height: 100 },
      },
      ...overrides,
    } as CartItem;
  }

  function attrKeys(item: CartItem): string[] {
    const result = buildCartLines([item]);
    if (!Array.isArray(result)) throw new Error('buildCartLines returned an error');
    return (result[0].attributes ?? []).map((a) => a.key);
  }

  test('STD-9 (single) → _photo_url + _crop_area; no _photo_urls', () => {
    const keys = attrKeys(
      makeItem({
        gridSize: 9,
        customizations: {
          categoryType: 'save-the-date',
          photoStorageUrl: 'https://cdn.shopify.com/photo.jpg',
          cropArea: { x: 0, y: 0, width: 100, height: 100 },
          eventText: 'Boda',
        },
      }),
    );
    expect(keys).toContain('_photo_url');
    expect(keys).toContain('_crop_area');
    expect(keys).not.toContain('_photo_urls');
  });

  test('STD-6 (single) → _photo_url + _crop_area; no _photo_urls', () => {
    const keys = attrKeys(
      makeItem({
        gridSize: 6,
        gridLayout: { rows: 3, cols: 2 },
        price: 360,
        customizations: {
          categoryType: 'save-the-date',
          photoStorageUrl: 'https://cdn.shopify.com/photo.jpg',
          cropArea: { x: 0, y: 0, width: 100, height: 100 },
          eventText: 'Aniversario',
        },
      }),
    );
    expect(keys).toContain('_photo_url');
    expect(keys).toContain('_crop_area');
    expect(keys).not.toContain('_photo_urls');
  });

  test('STD-3 (multi) → _photo_urls + _crop_areas + legacy _photo_url', () => {
    const keys = attrKeys(
      makeItem({
        gridSize: 3,
        gridLayout: { rows: 3, cols: 1 },
        price: 200,
        customizations: {
          categoryType: 'save-the-date',
          photoStorageUrls: [
            'https://cdn.shopify.com/a.jpg',
            'https://cdn.shopify.com/b.jpg',
            'https://cdn.shopify.com/c.jpg',
          ],
          cropAreas: [
            { x: 0, y: 0, width: 100, height: 100 },
            { x: 0, y: 0, width: 100, height: 100 },
            { x: 0, y: 0, width: 100, height: 100 },
          ],
          eventText: 'Baby Shower',
        },
      }),
    );
    expect(keys).toContain('_photo_urls');
    expect(keys).toContain('_crop_areas');
    expect(keys).toContain('_photo_url');
  });

  test('Tonos-9 (multi) → _photo_urls + _crop_areas + legacy _photo_url', () => {
    const keys = attrKeys(
      makeItem({
        gridSize: 9,
        gridLayout: { rows: 3, cols: 3 },
        customizations: {
          categoryType: 'tonos',
          photoStorageUrls: [
            'https://cdn.shopify.com/p1.jpg',
            'https://cdn.shopify.com/p2.jpg',
            'https://cdn.shopify.com/p3.jpg',
          ],
          cropAreas: [
            { x: 0, y: 0, width: 100, height: 100 },
            { x: 0, y: 0, width: 100, height: 100 },
            { x: 0, y: 0, width: 100, height: 100 },
          ],
          tonosIntensity: 'medium',
        },
      }),
    );
    expect(keys).toContain('_photo_urls');
    expect(keys).toContain('_crop_areas');
  });

  test('Mosaicos-9 (single) → _photo_url; no _photo_urls', () => {
    const keys = attrKeys(
      makeItem({
        gridSize: 9,
        gridLayout: { rows: 3, cols: 3 },
        customizations: {
          categoryType: 'mosaicos',
          photoStorageUrl: 'https://cdn.shopify.com/photo.jpg',
          cropArea: { x: 0, y: 0, width: 100, height: 100 },
        },
      }),
    );
    expect(keys).toContain('_photo_url');
    expect(keys).not.toContain('_photo_urls');
  });
});
