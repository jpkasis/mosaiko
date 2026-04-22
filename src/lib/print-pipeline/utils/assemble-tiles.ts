import sharp from 'sharp';
import { TILE_PRINT_SIZE } from '../../grid-config';
import type {
  CategoryCustomization,
  TonosCustomization,
} from '../../customization-types';
import { CATEGORY_LAYOUTS } from '../../category-layouts';
import { deriveCompositeLayout } from '../../category-layouts/derive';
import type { TileOutput } from '../types';

/**
 * Placement of one print tile inside the assembled composite canvas,
 * in pixels.
 */
export interface TilePlacement {
  index: number;
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Full layout of an assembled composite: canvas size + per-tile placements.
 */
export interface CompositeLayout {
  width: number;
  height: number;
  tiles: TilePlacement[];
}

/**
 * Resolves the grid layout each category uses when assembling its print
 * tiles into one gapless composite image.
 *
 * Adapter: delegates to `deriveCompositeLayout` in `category-layouts/`, so
 * the canonical layout data drives both the DOM preview (PR 1b) and the
 * server-side assembly. The `CompositeLayout` return shape is preserved for
 * existing callers.
 */
export function getCompositeLayout(
  customization: CategoryCustomization,
): CompositeLayout {
  const layout = CATEGORY_LAYOUTS[customization.categoryType];
  return deriveCompositeLayout(layout, customization.gridSize, TILE_PRINT_SIZE);
}

/**
 * Assembles a list of tile buffers into one gapless composite image using
 * the supplied layout. Tile buffers are placed at their declared pixel
 * positions; empty cells (not referenced by any tile) stay the canvas
 * background colour.
 *
 * Background defaults to white; callers can pass a custom colour to
 * approximate fridge tones. The composite is output as PNG for quality.
 */
export async function assembleTilesToComposite(
  tiles: TileOutput[],
  layout: CompositeLayout,
  background: { r: number; g: number; b: number; alpha: number } = {
    r: 255,
    g: 255,
    b: 255,
    alpha: 1,
  },
): Promise<Buffer> {
  const tileByIndex = new Map<number, Buffer>();
  for (const tile of tiles) {
    if (tileByIndex.has(tile.index)) {
      throw new Error(
        `[assemble-tiles] duplicate tile index ${tile.index} — a processor emitted the same tile twice`,
      );
    }
    tileByIndex.set(tile.index, tile.buffer);
  }

  // Every layout placement must have a matching tile. A missing tile would
  // silently produce a blank cell in the composite — better to fail loud
  // than render a misleading preview.
  for (const placement of layout.tiles) {
    if (!tileByIndex.has(placement.index)) {
      throw new Error(
        `[assemble-tiles] layout references tile index ${placement.index} but no such tile was produced`,
      );
    }
  }

  const canvas = sharp({
    create: {
      width: layout.width,
      height: layout.height,
      channels: 4,
      background,
    },
  });

  const composites: sharp.OverlayOptions[] = layout.tiles.map((placement) => ({
    input: tileByIndex.get(placement.index)!,
    left: placement.left,
    top: placement.top,
  }));

  return canvas.composite(composites).png().toBuffer();
}

/**
 * Tonos composites have darker photography; keep the cart thumbnail on a
 * neutral light background so surrounding empty cells (if any) don't look
 * like artefacts.
 */
export const CART_COMPOSITE_BG = { r: 248, g: 245, b: 239, alpha: 1 };

/** Type guard to narrow off the Tonos branch for `getCompositeLayout`. */
export function isTonosCustomization(
  c: CategoryCustomization,
): c is TonosCustomization {
  return c.categoryType === 'tonos';
}
