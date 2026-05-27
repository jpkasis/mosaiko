import type { CategoryLayout, LayoutTile } from './types';
import type { TonosToneColumn } from '../customization-types';

const TONE_COLUMNS: readonly TonosToneColumn[] = ['warm', 'none', 'cool'];

/**
 * Tonos: three uploaded photos × three tone treatments (warm / none / cool).
 *   - 9-grid (3×3): rows = which uploaded image, cols = tone treatment.
 *   - 3-grid (1×3): one photo per tile, each in a different tone column.
 *
 * Tonos always uploads 3 images regardless of grid size. Rotation is
 * disabled (multi-image flow). No frame, no overlays.
 */
function tilesFor(grid: 3 | 9): readonly LayoutTile<'tonos'>[] {
  if (grid === 9) {
    return Array.from({ length: 9 }, (_, i) => ({
      index: i,
      role: 'photo' as const,
      meta: {
        sourceImageIndex: Math.floor(i / 3) as 0 | 1 | 2,
        toneColumn: TONE_COLUMNS[i % 3],
      },
    }));
  }
  return Array.from({ length: 3 }, (_, i) => ({
    index: i,
    role: 'photo' as const,
    meta: {
      sourceImageIndex: i as 0 | 1 | 2,
      toneColumn: TONE_COLUMNS[i],
    },
  }));
}

export const tonosLayout = {
  type: 'tonos',
  uploadSlots: { 3: 3, 9: 3 },
  photoInputMode: { 3: 'multi-photo', 9: 'multi-photo' },
  rotatable: false,
  dimensions: {
    3: { rows: 1, cols: 3 },
    9: { rows: 3, cols: 3 },
  },
  // cropAspect falls back to GRID_CONFIGS — no override for Tonos.
  cropAspect: {},
  tiles: {
    3: tilesFor(3),
    9: tilesFor(9),
  },
  cropperOverlay: { 3: null, 9: null },
  frame: null,
  overlays: [],
} satisfies CategoryLayout<'tonos'>;
