/**
 * Parity test for the category-layout contract introduced in PR 1a.
 *
 * For each category × allowed grid size, asserts that the adapter outputs of
 * `getTileLayout`, `getEffectiveGridConfig`, `CATEGORY_LAYOUT_OVERRIDES`, and
 * `getCompositeLayout` match the values the pre-refactor switch statements
 * produced. The goal: prove the refactor is a no-op for every consumer.
 *
 * Written against `node:test` / `node:assert`, but the Mosaiko repo does not
 * yet have a test runner wired up — Next.js' bundler handles directory
 * imports natively (e.g. `./category-layouts` → `./category-layouts/index.ts`)
 * whereas Node's native ESM resolver does not. Wire this up when we add
 * vitest (planned for the post-refactor mobile polish work) or as part of
 * any future test infra.
 *
 * Polaroid and Studio per-tile PHOTO_AREAS parity is intentionally *not*
 * re-checked here — the contract ports the canonical photo-region
 * coordinates verbatim from the server processors, so the adapter
 * equivalence is trivial. The deeper client↔server geometry reconciliation
 * (CSS-% preview vs. server PHOTO_AREAS) lives in PR 1c.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getTileLayout, type CategoryCustomization } from '../../customization-types';
import {
  GRID_CONFIGS,
  TILE_PRINT_SIZE,
  getEffectiveGridConfig,
  CATEGORY_LAYOUT_OVERRIDES,
} from '../../grid-config';
import { getCompositeLayout } from '../../print-pipeline/utils/assemble-tiles';

// ─── Expected results hardcoded from the pre-refactor switch statements ────

test('getTileLayout: mosaicos — every grid returns N photo tiles', () => {
  for (const grid of [3, 6, 9] as const) {
    const tiles = getTileLayout({ categoryType: 'mosaicos', gridSize: grid });
    assert.equal(tiles.length, grid);
    tiles.forEach((t, i) => {
      assert.equal(t.index, i);
      assert.equal(t.role, 'photo');
      assert.equal(t.label, undefined);
      assert.equal(t.gridColumn, undefined);
      assert.equal(t.gridRow, undefined);
    });
  }
});

test('getTileLayout: polaroid — 4 photo tiles, no labels', () => {
  const tiles = getTileLayout({ categoryType: 'polaroid', gridSize: 4 });
  assert.equal(tiles.length, 4);
  tiles.forEach((t, i) => {
    assert.deepEqual(t, { index: i, role: 'photo' });
  });
});

test('getTileLayout: spotify — 4 photo + 2 bar tiles with correct labels', () => {
  const tiles = getTileLayout({
    categoryType: 'spotify',
    gridSize: 6,
    songName: '',
    artistName: '',
  });
  assert.equal(tiles.length, 6);
  for (let i = 0; i < 4; i++) {
    assert.deepEqual(tiles[i], { index: i, role: 'photo' });
  }
  assert.deepEqual(tiles[4], { index: 4, role: 'special', label: 'spotify-bar-left' });
  assert.deepEqual(tiles[5], { index: 5, role: 'special', label: 'spotify-bar-right' });
});

test('getTileLayout: tonos 9-grid — row = sourceImageIndex, col = toneColumn', () => {
  const tiles = getTileLayout({ categoryType: 'tonos', gridSize: 9, intensity: 'medium' });
  assert.equal(tiles.length, 9);
  const expectedTones = ['warm', 'none', 'cool'] as const;
  tiles.forEach((t, i) => {
    assert.equal(t.index, i);
    assert.equal(t.role, 'photo');
    assert.equal(t.sourceImageIndex, Math.floor(i / 3));
    assert.equal(t.toneColumn, expectedTones[i % 3]);
  });
});

test('getTileLayout: tonos 3-grid — one image per tile, warm/none/cool', () => {
  const tiles = getTileLayout({ categoryType: 'tonos', gridSize: 3, intensity: 'medium' });
  assert.equal(tiles.length, 3);
  const expectedTones = ['warm', 'none', 'cool'] as const;
  tiles.forEach((t, i) => {
    assert.equal(t.sourceImageIndex, i);
    assert.equal(t.toneColumn, expectedTones[i]);
  });
});

test('getTileLayout: save-the-date — 9 photo tiles', () => {
  const tiles = getTileLayout({
    categoryType: 'save-the-date',
    gridSize: 9,
    eventText: '',
    date: '',
    fontFamily: 'cormorant',
    fontSize: 'M',
    color: '#FFFFFF',
    anchor: 'top-center',
    treatment: 'shadow',
    intensity: 'medium',
  });
  assert.equal(tiles.length, 9);
  tiles.forEach((t, i) => assert.deepEqual(t, { index: i, role: 'photo' }));
});

test('getTileLayout: arte — 8 photo tiles + info tile at (row 3, col 4)', () => {
  const tiles = getTileLayout({
    categoryType: 'arte',
    gridSize: 9,
    title: '',
    artist: '',
    year: '',
  });
  assert.equal(tiles.length, 9);
  for (let i = 0; i < 8; i++) {
    assert.deepEqual(tiles[i], { index: i, role: 'photo' });
  }
  assert.deepEqual(tiles[8], {
    index: 8,
    role: 'special',
    label: 'arte-info',
    gridColumn: 4,
    gridRow: 3,
  });
});

test('getTileLayout: studio — 4 photo + 2 text-panel tiles', () => {
  const tiles = getTileLayout({
    categoryType: 'studio',
    gridSize: 6,
    year: '',
    japaneseText: '',
    customText: '',
    studioText: '',
  });
  assert.equal(tiles.length, 6);
  for (let i = 0; i < 4; i++) {
    assert.deepEqual(tiles[i], { index: i, role: 'photo' });
  }
  assert.deepEqual(tiles[4], { index: 4, role: 'text-panel', label: 'studio-left' });
  assert.deepEqual(tiles[5], { index: 5, role: 'text-panel', label: 'studio-right' });
});

// ─── getEffectiveGridConfig parity ─────────────────────────────────────────

test('getEffectiveGridConfig: mosaicos falls back to GRID_CONFIGS for every size', () => {
  for (const grid of [3, 6, 9] as const) {
    const cfg = getEffectiveGridConfig(grid, 'mosaicos');
    assert.deepEqual(cfg, GRID_CONFIGS[grid]);
  }
});

test('getEffectiveGridConfig: arte:9 uses 4×3 with aspect 2', () => {
  const cfg = getEffectiveGridConfig(9, 'arte');
  assert.equal(cfg.rows, 3);
  assert.equal(cfg.cols, 4);
  assert.equal(cfg.aspect, 4 / 2);
  assert.equal(cfg.price, GRID_CONFIGS[9].price);
});

test('getEffectiveGridConfig: spotify:6 uses square aspect', () => {
  const cfg = getEffectiveGridConfig(6, 'spotify');
  assert.equal(cfg.rows, 3);
  assert.equal(cfg.cols, 2);
  assert.equal(cfg.aspect, 1);
});

test('getEffectiveGridConfig: studio:6 uses 1055/1204 aspect', () => {
  const cfg = getEffectiveGridConfig(6, 'studio');
  assert.equal(cfg.rows, 3);
  assert.equal(cfg.cols, 2);
  assert.equal(cfg.aspect, 1055 / 1204);
});

test('getEffectiveGridConfig: polaroid:4 uses 180/160 aspect', () => {
  const cfg = getEffectiveGridConfig(4, 'polaroid');
  assert.equal(cfg.rows, 2);
  assert.equal(cfg.cols, 2);
  assert.equal(cfg.aspect, 180 / 160);
});

// ─── CATEGORY_LAYOUT_OVERRIDES parity (rotation-check callsite) ────────────

test('CATEGORY_LAYOUT_OVERRIDES: only holds non-base entries (preserves rotation-check semantics)', () => {
  assert.ok(CATEGORY_LAYOUT_OVERRIDES['arte:9']);
  assert.ok(CATEGORY_LAYOUT_OVERRIDES['spotify:6']);
  assert.ok(CATEGORY_LAYOUT_OVERRIDES['studio:6']);
  assert.ok(CATEGORY_LAYOUT_OVERRIDES['polaroid:4']);
  // Mosaicos, Tonos, Save-the-Date never had overrides pre-refactor; they
  // must still be absent so the `hasOverride` truthiness check keeps working.
  assert.equal(CATEGORY_LAYOUT_OVERRIDES['mosaicos:3'], undefined);
  assert.equal(CATEGORY_LAYOUT_OVERRIDES['mosaicos:6'], undefined);
  assert.equal(CATEGORY_LAYOUT_OVERRIDES['mosaicos:9'], undefined);
  assert.equal(CATEGORY_LAYOUT_OVERRIDES['tonos:3'], undefined);
  assert.equal(CATEGORY_LAYOUT_OVERRIDES['tonos:9'], undefined);
  assert.equal(CATEGORY_LAYOUT_OVERRIDES['save-the-date:9'], undefined);
});

// ─── getCompositeLayout parity ─────────────────────────────────────────────

const TILE = TILE_PRINT_SIZE;

test('getCompositeLayout: mosaicos 3 — 3×1 row-major', () => {
  const l = getCompositeLayout({ categoryType: 'mosaicos', gridSize: 3 });
  assert.equal(l.width, 3 * TILE);
  assert.equal(l.height, 1 * TILE);
  assert.equal(l.tiles.length, 3);
  l.tiles.forEach((t, i) => {
    assert.equal(t.index, i);
    assert.equal(t.left, i * TILE);
    assert.equal(t.top, 0);
    assert.equal(t.width, TILE);
    assert.equal(t.height, TILE);
  });
});

test('getCompositeLayout: mosaicos 9 — 3×3 row-major', () => {
  const l = getCompositeLayout({ categoryType: 'mosaicos', gridSize: 9 });
  assert.equal(l.width, 3 * TILE);
  assert.equal(l.height, 3 * TILE);
  assert.equal(l.tiles.length, 9);
  l.tiles.forEach((t, i) => {
    assert.equal(t.left, (i % 3) * TILE);
    assert.equal(t.top, Math.floor(i / 3) * TILE);
  });
});

test('getCompositeLayout: spotify — 2×3 row-major', () => {
  const l = getCompositeLayout({
    categoryType: 'spotify',
    gridSize: 6,
    songName: '',
    artistName: '',
  });
  assert.equal(l.width, 2 * TILE);
  assert.equal(l.height, 3 * TILE);
  assert.equal(l.tiles.length, 6);
});

test('getCompositeLayout: arte — sparse 4×3, tile 8 at col 3 row 2 (0-indexed)', () => {
  const l = getCompositeLayout({
    categoryType: 'arte',
    gridSize: 9,
    title: '',
    artist: '',
    year: '',
  });
  assert.equal(l.width, 4 * TILE);
  assert.equal(l.height, 3 * TILE);
  assert.equal(l.tiles.length, 9);
  for (let i = 0; i < 8; i++) {
    assert.equal(l.tiles[i].left, (i % 4) * TILE);
    assert.equal(l.tiles[i].top, Math.floor(i / 4) * TILE);
  }
  assert.equal(l.tiles[8].left, 3 * TILE);
  assert.equal(l.tiles[8].top, 2 * TILE);
});

test('getCompositeLayout: studio — 2×3 row-major', () => {
  const l = getCompositeLayout({
    categoryType: 'studio',
    gridSize: 6,
    year: '',
    japaneseText: '',
    customText: '',
    studioText: '',
  });
  assert.equal(l.width, 2 * TILE);
  assert.equal(l.height, 3 * TILE);
  assert.equal(l.tiles.length, 6);
});

test('getCompositeLayout: polaroid — 2×2 row-major', () => {
  const l = getCompositeLayout({ categoryType: 'polaroid', gridSize: 4 });
  assert.equal(l.width, 2 * TILE);
  assert.equal(l.height, 2 * TILE);
  assert.equal(l.tiles.length, 4);
});

test('getCompositeLayout: tonos 9 — 3×3; tonos 3 — 3×1', () => {
  const l9 = getCompositeLayout({ categoryType: 'tonos', gridSize: 9, intensity: 'medium' });
  assert.equal(l9.width, 3 * TILE);
  assert.equal(l9.height, 3 * TILE);
  assert.equal(l9.tiles.length, 9);

  const l3 = getCompositeLayout({ categoryType: 'tonos', gridSize: 3, intensity: 'medium' });
  assert.equal(l3.width, 3 * TILE);
  assert.equal(l3.height, 1 * TILE);
  assert.equal(l3.tiles.length, 3);
});

// ─── Invariants on the new contract itself ────────────────────────────────

test('Every category has tiles for every allowed grid size', () => {
  // Import lazily so the test file keeps working even if the old adapters
  // are later deleted — the contract is the authoritative source.
  return import('../index').then(({ CATEGORY_LAYOUTS }) => {
    for (const [cat, layout] of Object.entries(CATEGORY_LAYOUTS)) {
      for (const sizeStr of Object.keys(layout.dimensions)) {
        const size = Number(sizeStr) as keyof typeof layout.tiles;
        const tiles = layout.tiles[size];
        assert.ok(
          tiles,
          `${cat}:${String(size)} declares dimensions but no tiles`,
        );
        assert.equal(
          tiles!.length,
          (size as unknown as number) === 4 ? 4 : (size as unknown as number),
          `${cat}:${String(size)} tile count != gridSize`,
        );
        // Arte is the special case where tile count == gridSize (9) even
        // though the dimensions grid is 4 × 3 = 12 cells.
      }
    }
  });
});

// Structural parity: the contract mirrors every piece of legacy data covered
// above. Anyone adding a category must extend both the layout module and
// this test file — the `Record<CategoryType, CategoryLayout>` constraint on
// `CATEGORY_LAYOUTS` will surface missing entries at compile time.
