/**
 * PR-C single-tile Mosaico — config + default-pricing contract (single tile is freely editable).
 *
 * Locks the pieces the feature depends on:
 *   - GridSize includes 1; GRID_CONFIGS[1] is a 1×1 square at the default price
 *   - singleTilePriceFrom = ⌈3-piece / 3⌉ is the seed/migration DEFAULT only
 *     (the single tile is freely editable afterwards — not auto-derived)
 *   - mosaicos allows size 1 (appended last so it's never the default)
 *   - the seed matrix + PRICING_COMBOS carry mosaicos:1 (so the migration
 *     creates the variant automatically)
 *   - the client minimum-order helper excludes the single tile
 *   - the layout yields exactly one tile for size 1
 */
import { describe, test, expect } from 'vitest';
import { GRID_CONFIGS, singleTilePriceFrom } from '@/lib/grid-config';
import { CATEGORY_REGISTRY } from '@/lib/customization-types';
import { mosaicosLayout } from '@/lib/category-layouts/mosaicos';
import { SEED_PRICE_MATRIX, PRICING_COMBOS } from '@/lib/shopify/pricing-options';
import {
  cheapestStandardPrice,
  isGridAvailable,
  categoryMinPrice,
  priceFor,
} from '@/components/pricing/PricesProvider';
import { cartItemUnitPrice } from '@/lib/cart-pricing';

describe('PR-C single-tile price formula', () => {
  test('⌈price/3⌉ to whole pesos', () => {
    expect(singleTilePriceFrom(200)).toBe(67); // ⌈66.67⌉
    expect(singleTilePriceFrom(240)).toBe(80); // exact
    expect(singleTilePriceFrom(360)).toBe(120);
    expect(singleTilePriceFrom(100)).toBe(34); // ⌈33.33⌉
  });
});

describe('PR-C grid config', () => {
  test('GRID_CONFIGS[1] is a 1×1 square at the default price (67)', () => {
    const c = GRID_CONFIGS[1];
    expect(c.size).toBe(1);
    expect(c.rows).toBe(1);
    expect(c.cols).toBe(1);
    expect(c.aspect).toBe(1);
    expect(c.price).toBe(singleTilePriceFrom(200));
    expect(c.price).toBe(67);
    expect(c.label).toBe('grid1');
  });

  test('mosaicos allows size 1, appended last (never the implicit default)', () => {
    const sizes = CATEGORY_REGISTRY.mosaicos.allowedGridSizes;
    expect(sizes).toContain(1);
    expect(sizes[sizes.length - 1]).toBe(1);
    expect(sizes[0]).not.toBe(1);
  });
});

describe('PR-C pricing model wiring', () => {
  test('seed defaults mosaicos:1 from the 3-piece', () => {
    expect(SEED_PRICE_MATRIX.mosaicos[1]).toBe(67);
  });

  test('PRICING_COMBOS includes mosaicos:1 (migration creates the variant)', () => {
    const keys = new Set(PRICING_COMBOS.map((c) => `${c.category}:${c.gridSize}`));
    expect(keys.has('mosaicos:1')).toBe(true);
  });
});

describe('PR-C minimum-order helper (client)', () => {
  test('cheapestStandardPrice excludes the single tile', () => {
    expect(cheapestStandardPrice({ mosaicos: { 1: 67, 3: 200, 6: 360, 9: 480 } })).toBe(200);
  });
  test('a map of only single tiles → null (no standard floor)', () => {
    expect(cheapestStandardPrice({ mosaicos: { 1: 67 } })).toBeNull();
  });
  test('cheapest across categories wins', () => {
    expect(
      cheapestStandardPrice({ mosaicos: { 1: 67, 3: 200 }, polaroid: { 4: 480 } }),
    ).toBe(200);
  });
});

describe('PR-C layout', () => {
  test('size 1 yields exactly one photo tile', () => {
    expect(mosaicosLayout.tiles[1]).toHaveLength(1);
    expect(mosaicosLayout.dimensions[1]).toEqual({ rows: 1, cols: 1 });
    expect(mosaicosLayout.uploadSlots[1]).toBe(1);
  });
});

describe('PR-C single-tile availability (Codex audit — no dead $67 option)', () => {
  test('isGridAvailable: single tile offered ONLY when the live map has its price', () => {
    expect(isGridAvailable({ mosaicos: { 1: 67, 3: 200 } }, 'mosaicos', 1)).toBe(true);
    // pre-publish / v2 outage: map lacks mosaicos:1 → not offerable (no legacy 1-piece variant)
    expect(isGridAvailable({ mosaicos: { 3: 200 } }, 'mosaicos', 1)).toBe(false);
    // standard sizes stay available (legacy GRID_CONFIGS fallback)
    expect(isGridAvailable({}, 'mosaicos', 3)).toBe(true);
  });

  test('priceFor never synthesizes a single-tile price from GRID_CONFIGS', () => {
    expect(priceFor({ mosaicos: { 1: 67 } }, 'mosaicos', 1)).toBe(67);
    expect(priceFor({ mosaicos: {} }, 'mosaicos', 1)).toBe(0); // no fallback for the single tile
    expect(priceFor({ mosaicos: {} }, 'mosaicos', 3)).toBe(200); // standard sizes do fall back
  });

  test('categoryMinPrice ignores the single tile when its live price is absent', () => {
    expect(categoryMinPrice({ mosaicos: { 3: 200, 6: 360, 9: 480 } }, 'mosaicos')).toBe(200);
    expect(categoryMinPrice({ mosaicos: { 1: 67, 3: 200 } }, 'mosaicos')).toBe(67);
  });

  test('cartItemUnitPrice: single tile uses live map, else the stored price (never GRID_CONFIGS[1])', () => {
    const tile = {
      id: 'x',
      type: 'custom',
      name: '1 pieza',
      gridSize: 1,
      quantity: 1,
      price: 120, // freely-set price stored at add time
      previewUrl: '',
      tileUrls: [],
      customizations: { categoryType: 'mosaicos' },
    } as unknown as Parameters<typeof cartItemUnitPrice>[1];
    expect(cartItemUnitPrice({ mosaicos: { 1: 90 } }, tile)).toBe(90); // live wins
    expect(cartItemUnitPrice({ mosaicos: {} }, tile)).toBe(120); // stored, NOT GRID_CONFIGS[1]=67
  });
});
