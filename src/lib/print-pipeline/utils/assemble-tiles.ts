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
 *
 * Mosaicos `layoutRotated` handling: the flag is runtime user state — it
 * lives on the `MosaicosCustomization` variant, not inside the static
 * `CATEGORY_LAYOUTS` contract. When true, we construct a shallow-copied
 * layout with rows/cols swapped for the current grid size, then hand it
 * to `deriveCompositeLayout`. This keeps the contract pure geometry and
 * confines the rotation to the adapter boundary that already has access
 * to `customization`.
 */
export function getCompositeLayout(
  customization: CategoryCustomization,
): CompositeLayout {
  if (
    customization.categoryType === 'mosaicos' &&
    customization.layoutRotated === true
  ) {
    const base = CATEGORY_LAYOUTS.mosaicos;
    const dims = base.dimensions[customization.gridSize];
    if (!dims) {
      // Should be unreachable: MosaicosCustomization.gridSize is typed
      // as `3 | 6 | 9` and all three keys are populated in
      // category-layouts/mosaicos.ts.
      throw new Error(
        `[assemble-tiles] Missing mosaicos dimensions for grid ${customization.gridSize}`,
      );
    }
    const rotatedLayout = {
      ...base,
      dimensions: {
        ...base.dimensions,
        [customization.gridSize]: { rows: dims.cols, cols: dims.rows },
      },
    };
    return deriveCompositeLayout(
      rotatedLayout,
      customization.gridSize,
      TILE_PRINT_SIZE,
    );
  }

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
 * Inverse of `assembleTilesToComposite`: reads a fully-assembled
 * composite buffer + its layout and re-extracts the tile regions.
 *
 * Used by the order webhook to skip the entire `processPrintJob` cost
 * when the cart already produced the canonical composite (cart-composite
 * endpoint stored it under `cart-composites/<jobId>.png`). The composite
 * is the single source of truth: it has all tones, frames, text, and
 * effects baked in, so extracting tile-sized regions is correct for
 * every category — Tonos included.
 *
 * Validates composite dimensions against the layout before any extract;
 * mismatch throws so the caller (webhook) can fall back to the full
 * pipeline rather than ship corrupt tiles.
 *
 * Output filenames mirror the on-disk pattern used by storage so a tile
 * extracted here is byte-equivalent (within Sharp re-encode noise) to a
 * tile produced by the corresponding processor.
 */
export async function splitCompositeIntoTiles(
  composite: Buffer,
  layout: CompositeLayout,
  jobId: string,
): Promise<TileOutput[]> {
  const meta = await sharp(composite).metadata();
  if (meta.width !== layout.width || meta.height !== layout.height) {
    throw new Error(
      `[splitCompositeIntoTiles] composite dimensions ${meta.width}×${meta.height} ` +
        `do not match expected layout ${layout.width}×${layout.height}`,
    );
  }

  const tiles = await Promise.all(
    layout.tiles.map(async (placement): Promise<TileOutput> => {
      const buffer = await sharp(composite)
        .extract({
          left: placement.left,
          top: placement.top,
          width: placement.width,
          height: placement.height,
        })
        .png()
        .toBuffer();
      return {
        index: placement.index,
        buffer,
        filename: `${jobId}_tile_${placement.index}.png`,
      };
    }),
  );

  return tiles;
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
