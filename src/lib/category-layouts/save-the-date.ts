import type { CategoryLayout, LayoutTile } from './types';

const tiles: readonly LayoutTile<'save-the-date'>[] = Array.from(
  { length: 9 },
  (_, i) => ({ index: i, role: 'photo' as const }),
);

/**
 * Save the Date: 9-grid, 3 × 3. All tiles are photo; user text is composited
 * over the cropped photo before the tile split so each tile gets its slice
 * of the event text. The overlay is handled by the STD processor / preview
 * components, not by the tile descriptors.
 *
 * Rotation is disabled — the 9-grid is square and rotating would be a no-op.
 */
export const saveTheDateLayout = {
  type: 'save-the-date',
  uploadSlots: 1,
  rotatable: false,
  dimensions: {
    9: { rows: 3, cols: 3 },
  },
  cropAspect: {
    9: 1,
  },
  tiles: { 9: tiles },
  cropperOverlay: { 9: null },
  frame: null,
  overlays: [{ kind: 'save-the-date-text' }],
} satisfies CategoryLayout<'save-the-date'>;
