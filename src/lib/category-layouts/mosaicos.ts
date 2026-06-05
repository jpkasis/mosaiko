import type { CategoryLayout, LayoutTile } from './types';

const tiles = (count: 1 | 3 | 6 | 9): readonly LayoutTile<'mosaicos'>[] =>
  Array.from({ length: count }, (_, i) => ({
    index: i,
    role: 'photo' as const,
  }));

export const mosaicosLayout = {
  type: 'mosaicos',
  // PR-C: 1 = a single square tile (one magnet).
  uploadSlots: { 1: 1, 3: 1, 6: 1, 9: 1 },
  photoInputMode: { 1: 'single', 3: 'single', 6: 'single', 9: 'single' },
  rotatable: true,
  dimensions: {
    1: { rows: 1, cols: 1 },
    3: { rows: 1, cols: 3 },
    6: { rows: 3, cols: 2 },
    9: { rows: 3, cols: 3 },
  },
  // cropAspect falls back to GRID_CONFIGS for mosaicos — no override (1 → 1:1).
  cropAspect: {},
  tiles: {
    1: tiles(1),
    3: tiles(3),
    6: tiles(6),
    9: tiles(9),
  },
  cropperOverlay: { 1: null, 3: null, 6: null, 9: null },
  frame: null,
  overlays: [],
} satisfies CategoryLayout<'mosaicos'>;
