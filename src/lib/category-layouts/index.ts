import type { CategoryType } from '../customization-types';
import type { CategoryLayout } from './types';
import { mosaicosLayout } from './mosaicos';
import { spotifyLayout } from './spotify';
import { tonosLayout } from './tonos';
import { saveTheDateLayout } from './save-the-date';
import { arteLayout } from './arte';
import { studioLayout } from './studio';
import { polaroidLayout } from './polaroid';

/**
 * Authoritative per-category layout table. `Record<CategoryType, …>` forces
 * exhaustiveness — adding a new category triggers a compile error here until
 * its layout is registered.
 *
 * The type is intentionally widened to `CategoryLayout` (not the narrow
 * literal of each entry) so generic code can look up by a `CategoryType`
 * variable. Consumers who want the typed `meta` for a specific category
 * should import that category's module directly (e.g.
 * `import { tonosLayout } from '@/lib/category-layouts/tonos'`).
 */
export const CATEGORY_LAYOUTS: Record<CategoryType, CategoryLayout> = {
  mosaicos: mosaicosLayout,
  spotify: spotifyLayout,
  tonos: tonosLayout,
  'save-the-date': saveTheDateLayout,
  arte: arteLayout,
  studio: studioLayout,
  polaroid: polaroidLayout,
};

export function getCategoryLayout(category: CategoryType): CategoryLayout {
  return CATEGORY_LAYOUTS[category];
}

// Re-export the narrow-typed per-category modules for consumers that want
// to keep the typed `meta` on tiles.
export {
  mosaicosLayout,
  spotifyLayout,
  tonosLayout,
  saveTheDateLayout,
  arteLayout,
  studioLayout,
  polaroidLayout,
};

export type {
  CategoryLayout,
  CategoryTileMeta,
  LayoutTile,
  Frame,
  PhotoRegion,
  CropperOverlay,
  OverlaySpec,
} from './types';
