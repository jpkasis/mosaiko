/**
 * Integrity test: Save the Date supports 3 grid sizes (UAT-1b)
 *
 * Covers the contract additions across the layout/serializer/checkout
 * boundary so future refactors don't silently regress STD-6 or STD-3.
 *
 * Tests:
 *   - Layout parity: STD declares dimensions, tiles, photoInputMode,
 *     uploadSlots for 3/6/9 with the right shape.
 *   - Serializer round-trip: STD-6 and STD-3 customizations survive
 *     the buildPrintCustomization boundary.
 *   - Checkout cart attrs: STD-9 + STD-6 emit `_photo_url`/`_crop_area`;
 *     STD-3 emits `_photo_urls`/`_crop_areas` (plus legacy `_photo_url`).
 */
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { saveTheDateLayout } from '@/lib/category-layouts/save-the-date';
import {
  derivePhotoInput,
  deriveUploadSlots,
  isMultiPhotoInput,
} from '@/lib/category-layouts/derive';
import { CATEGORY_REGISTRY, STD_DEFAULTS } from '@/lib/customization-types';
import { buildPrintCustomization } from '@/lib/shopify/customization-serializer';
import { buildCartLines } from '@/lib/shopify/checkout';
import { getCompositeLayout } from '@/lib/print-pipeline/utils/assemble-tiles';
import { TILE_PRINT_SIZE } from '@/lib/grid-config';
import { getStepsForCategory } from '@/components/builder/useBuilderFlow';
import type { CartItem } from '@/lib/cart-store';

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

describe('Save the Date — 3 grid sizes (UAT-1b)', () => {
  test('CATEGORY_REGISTRY allows 9, 6, and 3 grids', () => {
    const meta = CATEGORY_REGISTRY['save-the-date'];
    expect(meta.allowedGridSizes).toEqual(expect.arrayContaining([9, 6, 3]));
    expect(meta.allowedGridSizes.length).toBe(3);
  });

  test('save-the-date layout declares dimensions for 3/6/9', () => {
    expect(saveTheDateLayout.dimensions[9]).toEqual({ rows: 3, cols: 3 });
    expect(saveTheDateLayout.dimensions[6]).toEqual({ rows: 3, cols: 2 });
    expect(saveTheDateLayout.dimensions[3]).toEqual({ rows: 3, cols: 1 });
  });

  test('save-the-date layout declares tiles for 3/6/9', () => {
    expect(saveTheDateLayout.tiles[9]?.length).toBe(9);
    expect(saveTheDateLayout.tiles[6]?.length).toBe(6);
    expect(saveTheDateLayout.tiles[3]?.length).toBe(3);
  });

  test('STD-3 tiles carry sourceImageIndex 0/1/2 for multi-photo dispatch', () => {
    const tiles = saveTheDateLayout.tiles[3]!;
    const sourceIndices = tiles.map((t) => t.meta?.sourceImageIndex);
    expect(sourceIndices).toEqual([0, 1, 2]);
  });

  test('photoInputMode: 9 and 6 are single-photo, 3 is multi-photo', () => {
    expect(derivePhotoInput(saveTheDateLayout, 9)).toBe('single');
    expect(derivePhotoInput(saveTheDateLayout, 6)).toBe('single');
    expect(derivePhotoInput(saveTheDateLayout, 3)).toBe('multi-photo');
    expect(isMultiPhotoInput(saveTheDateLayout, 3)).toBe(true);
    expect(isMultiPhotoInput(saveTheDateLayout, 6)).toBe(false);
    expect(isMultiPhotoInput(saveTheDateLayout, 9)).toBe(false);
  });

  test('uploadSlots: 9 and 6 are 1-slot, 3 is 3-slot', () => {
    expect(deriveUploadSlots(saveTheDateLayout, 9)).toBe(1);
    expect(deriveUploadSlots(saveTheDateLayout, 6)).toBe(1);
    expect(deriveUploadSlots(saveTheDateLayout, 3)).toBe(3);
  });

  test('save-the-date layout is rotatable (UAT-1b)', () => {
    expect(saveTheDateLayout.rotatable).toBe(true);
  });
});

describe('Save the Date serializer round-trip', () => {
  test('STD-9 customization preserves gridSize 9', () => {
    const result = buildPrintCustomization({
      categoryType: 'save-the-date',
      gridSize: 9,
      textFields: { eventText: 'Our Wedding', date: '2026-12-31' },
    });
    expect(result.categoryType).toBe('save-the-date');
    if (result.categoryType !== 'save-the-date') return;
    expect(result.gridSize).toBe(9);
    expect(result.eventText).toBe('Our Wedding');
    expect(result.date).toBe('2026-12-31');
  });

  test('STD-6 customization preserves gridSize 6', () => {
    const result = buildPrintCustomization({
      categoryType: 'save-the-date',
      gridSize: 6,
      textFields: { eventText: 'Engagement', date: '2027-01-15' },
    });
    expect(result.categoryType).toBe('save-the-date');
    if (result.categoryType !== 'save-the-date') return;
    expect(result.gridSize).toBe(6);
  });

  test('STD-3 customization preserves gridSize 3', () => {
    const result = buildPrintCustomization({
      categoryType: 'save-the-date',
      gridSize: 3,
      textFields: { eventText: 'Baby Shower', date: '2026-09-01' },
    });
    expect(result.categoryType).toBe('save-the-date');
    if (result.categoryType !== 'save-the-date') return;
    expect(result.gridSize).toBe(3);
  });

  test('STD layoutRotated forwards through the serializer', () => {
    const result = buildPrintCustomization({
      categoryType: 'save-the-date',
      gridSize: 6,
      textFields: { eventText: 'Compromiso', date: '2027-02-14' },
      layoutRotated: true,
    });
    expect(result.categoryType).toBe('save-the-date');
    if (result.categoryType !== 'save-the-date') return;
    expect(result.layoutRotated).toBe(true);
  });
});

function makeCustomItem(
  gridSize: 3 | 6 | 9,
  customizations: CartItem['customizations'],
): CartItem {
  const rows = gridSize === 9 ? 3 : gridSize === 6 ? 3 : 3;
  const cols = gridSize === 9 ? 3 : gridSize === 6 ? 2 : 1;
  return {
    id: 'cart-line-std',
    type: 'custom',
    name: `Save the Date ${gridSize}p`,
    gridSize,
    gridLayout: { rows, cols },
    price: gridSize === 9 ? 480 : gridSize === 6 ? 360 : 200,
    quantity: 1,
    previewUrl: 'https://cdn.shopify.com/test.png',
    tileUrls: [],
    customizations,
  };
}

describe('Save the Date checkout cart line attrs', () => {
  test('STD-9 emits _photo_url + _crop_area (single-photo)', () => {
    const item = makeCustomItem(9, {
      categoryType: 'save-the-date',
      textFields: { eventText: 'Wedding', date: '2026-12-31' },
      photoStorageUrl: 'https://cdn.shopify.com/wedding.jpg',
      cropArea: { x: 0, y: 0, width: 100, height: 100 },
    });
    const result = buildCartLines([item]);
    expect(Array.isArray(result)).toBe(true);
    if (!Array.isArray(result)) return;
    const attrs = result[0].attributes ?? [];
    const keys = attrs.map((a) => a.key);
    expect(keys).toContain('_photo_url');
    expect(keys).toContain('_crop_area');
    expect(keys).not.toContain('_photo_urls');
    expect(keys).not.toContain('_crop_areas');
  });

  test('STD-6 emits _photo_url + _crop_area (single-photo)', () => {
    const item = makeCustomItem(6, {
      categoryType: 'save-the-date',
      textFields: { eventText: 'Engagement', date: '2027-01-15' },
      photoStorageUrl: 'https://cdn.shopify.com/engagement.jpg',
      cropArea: { x: 0, y: 0, width: 100, height: 150 },
    });
    const result = buildCartLines([item]);
    expect(Array.isArray(result)).toBe(true);
    if (!Array.isArray(result)) return;
    const attrs = result[0].attributes ?? [];
    const keys = attrs.map((a) => a.key);
    expect(keys).toContain('_photo_url');
    expect(keys).toContain('_crop_area');
    expect(keys).not.toContain('_photo_urls');
    expect(keys).not.toContain('_crop_areas');
  });

  test('STD-3 emits _photo_urls + _crop_areas + legacy _photo_url (multi-photo)', () => {
    const item = makeCustomItem(3, {
      categoryType: 'save-the-date',
      textFields: { eventText: 'Baby Shower', date: '2026-09-01' },
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
    });
    const result = buildCartLines([item]);
    expect(Array.isArray(result)).toBe(true);
    if (!Array.isArray(result)) return;
    const attrs = result[0].attributes ?? [];
    const keys = attrs.map((a) => a.key);
    expect(keys).toContain('_photo_urls');
    expect(keys).toContain('_crop_areas');
    // Legacy single-URL key is also stamped with the first photo for
    // admin detection + the webhook's _-prefix filter.
    expect(keys).toContain('_photo_url');
    const photoUrlValue = attrs.find((a) => a.key === '_photo_url')?.value;
    expect(photoUrlValue).toBe('https://cdn.shopify.com/p1.jpg');
  });

  test('STD-3 composite layout: vertical 3×1 by default', () => {
    const layout = getCompositeLayout({
      categoryType: 'save-the-date',
      gridSize: 3,
      eventText: '',
      date: '',
      fontFamily: STD_DEFAULTS.fontFamily,
      fontSize: STD_DEFAULTS.fontSize,
      color: STD_DEFAULTS.color,
      anchor: STD_DEFAULTS.anchor,
      treatment: STD_DEFAULTS.treatment,
      intensity: STD_DEFAULTS.intensity,
    });
    expect(layout.width).toBe(1 * TILE_PRINT_SIZE);
    expect(layout.height).toBe(3 * TILE_PRINT_SIZE);
    expect(layout.tiles.length).toBe(3);
  });

  test('STD-3 composite layout: rotates to horizontal 1×3 with layoutRotated', () => {
    const layout = getCompositeLayout({
      categoryType: 'save-the-date',
      gridSize: 3,
      eventText: '',
      date: '',
      fontFamily: STD_DEFAULTS.fontFamily,
      fontSize: STD_DEFAULTS.fontSize,
      color: STD_DEFAULTS.color,
      anchor: STD_DEFAULTS.anchor,
      treatment: STD_DEFAULTS.treatment,
      intensity: STD_DEFAULTS.intensity,
      layoutRotated: true,
    });
    // Rotated: 3 cols × 1 row instead of 1 col × 3 rows.
    expect(layout.width).toBe(3 * TILE_PRINT_SIZE);
    expect(layout.height).toBe(1 * TILE_PRINT_SIZE);
    expect(layout.tiles.length).toBe(3);
  });

  test('STD-6 composite layout: portrait 2×3 by default; landscape 3×2 when rotated', () => {
    const portrait = getCompositeLayout({
      categoryType: 'save-the-date',
      gridSize: 6,
      eventText: '',
      date: '',
      fontFamily: STD_DEFAULTS.fontFamily,
      fontSize: STD_DEFAULTS.fontSize,
      color: STD_DEFAULTS.color,
      anchor: STD_DEFAULTS.anchor,
      treatment: STD_DEFAULTS.treatment,
      intensity: STD_DEFAULTS.intensity,
    });
    expect(portrait.width).toBe(2 * TILE_PRINT_SIZE);
    expect(portrait.height).toBe(3 * TILE_PRINT_SIZE);

    const landscape = getCompositeLayout({
      categoryType: 'save-the-date',
      gridSize: 6,
      eventText: '',
      date: '',
      fontFamily: STD_DEFAULTS.fontFamily,
      fontSize: STD_DEFAULTS.fontSize,
      color: STD_DEFAULTS.color,
      anchor: STD_DEFAULTS.anchor,
      treatment: STD_DEFAULTS.treatment,
      intensity: STD_DEFAULTS.intensity,
      layoutRotated: true,
    });
    expect(landscape.width).toBe(3 * TILE_PRINT_SIZE);
    expect(landscape.height).toBe(2 * TILE_PRINT_SIZE);
  });

  test('STD-9 composite layout: rotation is a no-op (square)', () => {
    const square = getCompositeLayout({
      categoryType: 'save-the-date',
      gridSize: 9,
      eventText: '',
      date: '',
      fontFamily: STD_DEFAULTS.fontFamily,
      fontSize: STD_DEFAULTS.fontSize,
      color: STD_DEFAULTS.color,
      anchor: STD_DEFAULTS.anchor,
      treatment: STD_DEFAULTS.treatment,
      intensity: STD_DEFAULTS.intensity,
      layoutRotated: true,
    });
    expect(square.width).toBe(3 * TILE_PRINT_SIZE);
    expect(square.height).toBe(3 * TILE_PRINT_SIZE);
  });

  test('Tonos still emits _photo_urls (regression check)', () => {
    const item: CartItem = {
      id: 'cart-line-tonos',
      type: 'custom',
      name: 'Tonos 9p',
      gridSize: 9,
      gridLayout: { rows: 3, cols: 3 },
      price: 480,
      quantity: 1,
      previewUrl: 'https://cdn.shopify.com/test.png',
      tileUrls: [],
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
    };
    const result = buildCartLines([item]);
    expect(Array.isArray(result)).toBe(true);
    if (!Array.isArray(result)) return;
    const keys = (result[0].attributes ?? []).map((a) => a.key);
    expect(keys).toContain('_photo_urls');
    expect(keys).toContain('_crop_areas');
  });
});

// Contract for the crop-step CTA label: MagnetBuilder picks the "next"
// label (tc('next')) when the step after `crop` is `customize`, and the
// "preview" label (t('stepPreview')) when it's `preview`. This guards
// the assumption — if a category gains/loses a customize step, the CTA
// wiring must follow.
describe('Builder step sequence — crop CTA label contract', () => {
  test('STD (all grids) places `customize` immediately after `crop`', () => {
    const steps = getStepsForCategory('save-the-date');
    const cropIdx = steps.indexOf('crop');
    expect(cropIdx).toBeGreaterThanOrEqual(0);
    expect(steps[cropIdx + 1]).toBe('customize');
  });

  test('Tonos places `preview` immediately after `crop` (no customize)', () => {
    const steps = getStepsForCategory('tonos');
    const cropIdx = steps.indexOf('crop');
    expect(cropIdx).toBeGreaterThanOrEqual(0);
    expect(steps[cropIdx + 1]).toBe('preview');
    expect(steps).not.toContain('customize');
  });

  test('Mosaicos places `preview` immediately after `crop` (no customize)', () => {
    const steps = getStepsForCategory('mosaicos');
    const cropIdx = steps.indexOf('crop');
    expect(cropIdx).toBeGreaterThanOrEqual(0);
    expect(steps[cropIdx + 1]).toBe('preview');
    expect(steps).not.toContain('customize');
  });
});
