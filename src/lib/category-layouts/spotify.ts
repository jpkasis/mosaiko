import type { CategoryLayout } from './types';

/**
 * Spotify: 6-grid, 3 rows × 2 cols.
 *   - Tiles 0-3: photo tiles (top 2 rows × 2 cols forming a 2×2 square).
 *   - Tiles 4-5: Spotify bar (bottom row) — template PNGs with text overlay.
 *
 * The crop stage is square because the photo area is 2×2; everything below is
 * synthesized from 5.png / 6.png templates + `songName` / `artistName`.
 */
export const spotifyLayout = {
  type: 'spotify',
  uploadSlots: 1,
  rotatable: false,
  dimensions: {
    6: { rows: 3, cols: 2 },
  },
  cropAspect: {
    6: 1,
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
  frame: null,
  overlays: [{ kind: 'spotify-bar' }],
} satisfies CategoryLayout<'spotify'>;
