import type { CategoryLayout } from './types';

/**
 * Polaroid: 4-grid, 2 rows × 2 cols. Every tile is a photo inside a white
 * Polaroid frame (template PNGs). The photo sits behind a PNG cutout; the
 * cutout position differs per tile (each tile shows a different corner of
 * the frame).
 *
 * Photo-region coordinates are measured in the template PNGs' native 615-px
 * space. The vertical split between tiles 1-2 (top row) and 3-4 (bottom row)
 * is 551 / (551 + 433) ≈ 55.99% — the same value the client preview and
 * cropper overlay use.
 *
 * Crop aspect is 180/160 (the visible photo opening when tiles are composed,
 * ≈ 1.125). Rotation is disabled — the frame is asymmetric.
 */
export const polaroidLayout = {
  type: 'polaroid',
  uploadSlots: 1,
  rotatable: false,
  dimensions: {
    4: { rows: 2, cols: 2 },
  },
  cropAspect: {
    4: 180 / 160,
  },
  tiles: {
    4: [
      { index: 0, role: 'photo' },
      { index: 1, role: 'photo' },
      { index: 2, role: 'photo' },
      { index: 3, role: 'photo' },
    ],
  },
  cropperOverlay: {
    // One row split at 55.96% — matches 551 / (551 + 433) within rounding,
    // and matches the client preview's vSplit.
    4: { rowSplits: [55.96] },
  },
  // Photo-region bounds below are verified against the actual template PNGs
  // by `scripts/measure-frame-templates.ts`. Re-run that script if the
  // templates are re-exported from source.
  frame: {
    templateDir: 'polaroid',
    photo: {
      sourceSize: 615,
      tiles: {
        // tile 1 (top-left): frame on top + left
        0: { left: 61, top: 64, right: 615, bottom: 615 },
        // tile 2 (top-right): frame on top + right
        1: { left: 0, top: 64, right: 554, bottom: 615 },
        // tile 3 (bottom-left): frame on left + bottom
        2: { left: 61, top: 0, right: 615, bottom: 433 },
        // tile 4 (bottom-right): frame on right + bottom
        3: { left: 0, top: 0, right: 554, bottom: 433 },
      },
    },
  },
  overlays: [],
} satisfies CategoryLayout<'polaroid'>;
