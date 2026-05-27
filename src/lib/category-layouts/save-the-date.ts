import type { CategoryLayout, LayoutTile } from './types';

/**
 * Save the Date — three grid sizes, all sharing the same text overlay.
 *
 * UAT-1b (2026-05-22) expanded this from STD-9-only to STD-{9,6,3}:
 *   - 9 (3×3 square): single-photo, text overlay across cropped photo,
 *     split into 9 tiles. Unchanged from the pre-UAT-1b implementation.
 *   - 6 (3×2 portrait by default, rotates to 2×3 landscape): single-photo,
 *     same text overlay pattern, split into 6 tiles.
 *   - 3 (3×1 vertical strip by default, rotates to 1×3 horizontal):
 *     MULTI-PHOTO — user uploads 3 photos, one per tile. Same SaveTheDate
 *     text overlay (eventText + date). NO Tonos color/intensity effects.
 *
 * Rotation is enabled because STD-6 and STD-3 are non-square; the cropper
 * lets the user flip portrait↔landscape. STD-9 is square so rotation is
 * a no-op (per the existing canRotateLayout check in useBuilderFlow).
 *
 * STD-3 multi-photo tiles declare `meta.sourceImageIndex` so the print
 * processor knows which uploaded photo goes into each tile. STD-9 and
 * STD-6 tiles are single-photo (no sourceImageIndex needed).
 */
const tilesForSingle = (count: 6 | 9): readonly LayoutTile<'save-the-date'>[] =>
  Array.from({ length: count }, (_, i) => ({
    index: i,
    role: 'photo' as const,
  }));

const stdMultiTiles: readonly LayoutTile<'save-the-date'>[] = [
  { index: 0, role: 'photo', meta: { sourceImageIndex: 0 } },
  { index: 1, role: 'photo', meta: { sourceImageIndex: 1 } },
  { index: 2, role: 'photo', meta: { sourceImageIndex: 2 } },
];

export const saveTheDateLayout = {
  type: 'save-the-date',
  uploadSlots: { 9: 1, 6: 1, 3: 3 },
  photoInputMode: { 9: 'single', 6: 'single', 3: 'multi-photo' },
  // STD-9 is square so rotation is a no-op; STD-6 (3×2) and STD-3 (3×1)
  // both benefit from portrait↔landscape rotation.
  rotatable: true,
  dimensions: {
    9: { rows: 3, cols: 3 },
    6: { rows: 3, cols: 2 },
    3: { rows: 3, cols: 1 },
  },
  cropAspect: {
    9: 1,
    6: 2 / 3,
    3: 1 / 3,
  },
  tiles: {
    9: tilesForSingle(9),
    6: tilesForSingle(6),
    3: stdMultiTiles,
  },
  cropperOverlay: { 9: null, 6: null, 3: null },
  frame: null,
  overlays: [{ kind: 'save-the-date-text' }],
} satisfies CategoryLayout<'save-the-date'>;
