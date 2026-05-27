import type { CategoryLayout } from './types';

/**
 * Spotify: 6-grid, 3 rows × 2 cols.
 *   - Tiles 0-3: photo tiles (top 2 rows × 2 cols forming a 2×2 square).
 *   - Tiles 4-5: Spotify bar (bottom row) — template PNGs with text overlay.
 *
 * Photo region: each tile's template PNG (`public/templates/spotify/{1..4}.png`)
 * has an opaque rounded-rectangle border that masks part of the photo. The
 * `frame.photo.tiles` bounds were measured from the template PNGs' alpha
 * channel — they record where the transparent area (where the user's photo
 * shows through) sits within each 615×615 native template. Same pattern as
 * Polaroid + Studio.
 *
 * Combined visible region across the 4 photo tiles (in 1230×1230 native
 * combined space): left=60, top=75, right=1169, bottom=1227 →
 * width=1109, height=1152, aspect ≈ 0.963 (slightly portrait).
 */
export const spotifyLayout = {
  type: 'spotify',
  uploadSlots: { 6: 1 },
  photoInputMode: { 6: 'single' },
  rotatable: false,
  dimensions: {
    6: { rows: 3, cols: 2 },
  },
  cropAspect: {
    // Matches the combined photo region's aspect, so the cropper shows the
    // user exactly the framing they'll see in the printed magnet — no part
    // of their crop is hidden by the template's opaque border.
    6: 1109 / 1152,
  },
  tiles: {
    6: [
      { index: 0, role: 'photo' },
      { index: 1, role: 'photo' },
      { index: 2, role: 'photo' },
      { index: 3, role: 'photo' },
      { index: 4, role: 'special', meta: { label: 'spotify-bar-left' } },
      { index: 5, role: 'special', meta: { label: 'spotify-bar-right' } },
    ],
  },
  cropperOverlay: {
    // 2 rows × 2 cols — shows the 2×2 photo split under the crop frame.
    6: { rows: 2 },
  },
  frame: {
    templateDir: '/templates/spotify',
    photo: {
      // Native template size; tiles 1 and 3 are 614 px wide vs 615 — we
      // treat 615 as canonical and accept the 1-px difference (same
      // convention Polaroid uses).
      sourceSize: 615,
      tiles: {
        0: { left: 60, top: 75, right: 615, bottom: 615 }, // top-left
        1: { left: 0,  top: 75, right: 554, bottom: 615 }, // top-right
        2: { left: 60, top: 0,  right: 615, bottom: 612 }, // bottom-left
        3: { left: 0,  top: 0,  right: 554, bottom: 612 }, // bottom-right
      },
    },
  },
  overlays: [{ kind: 'spotify-bar' }],
} satisfies CategoryLayout<'spotify'>;
