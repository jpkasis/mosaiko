import type { CategoryLayout } from './types';

/**
 * Studio: 6-grid, 3 rows × 2 cols.
 *   - Tiles 0-3: photo inside cream+teal PNG frame.
 *   - Tiles 4-5: text-panel backgrounds with a 63-px photo strip bleeding
 *     from the bottom of tile 3-4 into the top of tile 5-6.
 *
 * Photo-region coordinates are in the template PNGs' native 615-px space.
 * Crop aspect is 1055/1204 — derived from the combined visible photo area
 * across all photo tiles plus the 63-px bleed strip:
 *     (colLeftW + colRightW) / (rowTopH + rowBotH + stripH)
 *   = (528 + 527) / (526 + 615 + 63)
 *   = 1055 / 1204
 *
 * Rotation is disabled — the frame and text panels are asymmetric.
 */
export const studioLayout = {
  type: 'studio',
  uploadSlots: 1,
  rotatable: false,
  dimensions: {
    6: { rows: 3, cols: 2 },
  },
  cropAspect: {
    6: 1055 / 1204,
  },
  tiles: {
    6: [
      { index: 0, role: 'photo' },
      { index: 1, role: 'photo' },
      { index: 2, role: 'photo' },
      { index: 3, role: 'photo' },
      { index: 4, role: 'text-panel', meta: { label: 'studio-left' } },
      { index: 5, role: 'text-panel', meta: { label: 'studio-right' } },
    ],
  },
  cropperOverlay: {
    // Two row splits carving the cropper into the 4-photo-tile grid plus
    // the 63-px text-panel bleed strip. 43.69% = 526/1204 (top-row height),
    // 94.77% = (526+615)/1204 (top of the bleed strip).
    6: { rowSplits: [43.69, 94.77] },
  },
  // Photo-region bounds below are verified against the actual template PNGs
  // by `scripts/measure-frame-templates.ts`. Re-run that script if the
  // templates are re-exported from source.
  frame: {
    templateDir: 'studio',
    photo: {
      sourceSize: 615,
      tiles: {
        0: { left: 87, top: 88, right: 615, bottom: 614 },
        1: { left: 0, top: 88, right: 527, bottom: 614 },
        2: { left: 87, top: 0, right: 615, bottom: 615 },
        3: { left: 0, top: 0, right: 527, bottom: 615 },
      },
      photoStripHeight: 63,
    },
  },
  overlays: [{ kind: 'studio-text-panels' }],
} satisfies CategoryLayout<'studio'>;
