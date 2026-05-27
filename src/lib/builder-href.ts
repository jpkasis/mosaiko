import type { CategoryType } from './customization-types';
import type { GridSize } from './grid-config';

/**
 * Typed href shape for `<Link>` from `@/i18n/navigation`. The
 * builder reads `category` (always) and `grid` (optional) from
 * the query string in `useBuilderFlow`:
 * - both → start at the upload step
 * - category only → start at the grid-selection step
 * - neither → start at category selection
 *
 * Single source of truth for *every* link into `/personalizar`.
 * Don't construct `{ pathname: '/personalizar', query: {...} }` ad
 * hoc — call this helper. Centralizing the shape means future
 * additions (orientation, productId, etc.) live in one place.
 */
export type PersonalizarHref = {
  pathname: '/personalizar';
  query:
    | { category: CategoryType; grid: string }
    | { category: CategoryType };
};

interface PersonalizarTargetWithGrid {
  category: CategoryType;
  gridSize: GridSize;
}

interface PersonalizarTargetCategoryOnly {
  category: CategoryType;
}

export function buildPersonalizarHref(target: PersonalizarTargetWithGrid): PersonalizarHref;
export function buildPersonalizarHref(target: PersonalizarTargetCategoryOnly): PersonalizarHref;
export function buildPersonalizarHref(
  target: PersonalizarTargetWithGrid | PersonalizarTargetCategoryOnly,
): PersonalizarHref {
  if ('gridSize' in target) {
    return {
      pathname: '/personalizar',
      query: {
        category: target.category,
        grid: String(target.gridSize),
      },
    };
  }
  return {
    pathname: '/personalizar',
    query: { category: target.category },
  };
}
