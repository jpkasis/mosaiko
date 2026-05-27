import type { CategoryLayout, LayoutTile } from './types';

const tiles = (count: 3 | 6 | 9): readonly LayoutTile<'mosaicos'>[] =>
  Array.from({ length: count }, (_, i) => ({
    index: i,
    role: 'photo' as const,
  }));

export const mosaicosLayout = {
  type: 'mosaicos',
  uploadSlots: { 3: 1, 6: 1, 9: 1 },
  photoInputMode: { 3: 'single', 6: 'single', 9: 'single' },
  rotatable: true,
  dimensions: {
    3: { rows: 1, cols: 3 },
    6: { rows: 3, cols: 2 },
    9: { rows: 3, cols: 3 },
  },
  // cropAspect falls back to GRID_CONFIGS for mosaicos — no override.
  cropAspect: {},
  tiles: {
    3: tiles(3),
    6: tiles(6),
    9: tiles(9),
  },
  cropperOverlay: { 3: null, 6: null, 9: null },
  frame: null,
  overlays: [],
} satisfies CategoryLayout<'mosaicos'>;
