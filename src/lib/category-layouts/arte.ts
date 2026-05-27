import type { CategoryLayout } from './types';

/**
 * Arte: 9 tiles in a sparse 4 cols × 3 rows composite.
 *   - Tiles 0-7: photo, filling the top 2 rows (4 tiles wide).
 *   - Tile 8: museum-label info panel at (row 3, col 4) — bottom-right corner.
 *
 * The crop stage is 4/2 = 2 (double-wide landscape). Rotation is disabled.
 */
export const arteLayout = {
  type: 'arte',
  uploadSlots: { 9: 1 },
  photoInputMode: { 9: 'single' },
  rotatable: false,
  dimensions: {
    9: { rows: 3, cols: 4 },
  },
  cropAspect: {
    9: 4 / 2,
  },
  tiles: {
    9: [
      { index: 0, role: 'photo' },
      { index: 1, role: 'photo' },
      { index: 2, role: 'photo' },
      { index: 3, role: 'photo' },
      { index: 4, role: 'photo' },
      { index: 5, role: 'photo' },
      { index: 6, role: 'photo' },
      { index: 7, role: 'photo' },
      { index: 8, role: 'special', row: 3, col: 4, meta: { label: 'arte-info' } },
    ],
  },
  cropperOverlay: {
    // 2 rows × 4 cols — only the photo region (top two rows of the final
    // composite). The info tile at (3,4) is not represented in the cropper.
    9: { rows: 2, cols: 4 },
  },
  frame: null,
  overlays: [{ kind: 'arte-info-tile' }],
} satisfies CategoryLayout<'arte'>;
