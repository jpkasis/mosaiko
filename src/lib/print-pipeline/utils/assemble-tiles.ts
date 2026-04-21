import sharp from 'sharp';
import { TILE_PRINT_SIZE } from '../../grid-config';
import type {
  CategoryCustomization,
  TonosCustomization,
} from '../../customization-types';
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
 * tiles into one gapless composite image. Driven by the same descriptors
 * the DOM preview uses, so the canonical composite matches what the user
 * sees in the step-5 interactive preview.
 *
 * Default for most categories: row-major placement at TILE_PRINT_SIZE.
 * Arte is the special case — sparse 4×3 grid where tiles 0-7 occupy the
 * top two rows and tile 8 sits at (row=2, col=3).
 */
export function getCompositeLayout(
  customization: CategoryCustomization,
): CompositeLayout {
  const TILE = TILE_PRINT_SIZE;

  switch (customization.categoryType) {
    case 'mosaicos': {
      const size = customization.gridSize;
      const { rows, cols } = gridRowsCols(size);
      return rowMajorLayout(rows, cols, TILE, size);
    }

    case 'save-the-date': {
      const rows = 3;
      const cols = 3;
      return rowMajorLayout(rows, cols, TILE, 9);
    }

    case 'spotify': {
      // 3 rows × 2 cols; tiles 0-3 photo (rows 0-1), tiles 4-5 bottom bar (row 2)
      return rowMajorLayout(3, 2, TILE, 6);
    }

    case 'arte': {
      // 4 cols × 3 rows, sparse: tiles 0-7 in rows 0-1, tile 8 at (row=2, col=3)
      const tiles: TilePlacement[] = [];
      for (let i = 0; i < 8; i++) {
        const row = Math.floor(i / 4);
        const col = i % 4;
        tiles.push({ index: i, left: col * TILE, top: row * TILE, width: TILE, height: TILE });
      }
      tiles.push({ index: 8, left: 3 * TILE, top: 2 * TILE, width: TILE, height: TILE });
      return { width: 4 * TILE, height: 3 * TILE, tiles };
    }

    case 'studio': {
      // 2 cols × 3 rows; tiles 0-3 photo (rows 0-1), tiles 4-5 text panels (row 2)
      return rowMajorLayout(3, 2, TILE, 6);
    }

    case 'polaroid': {
      return rowMajorLayout(2, 2, TILE, 4);
    }

    case 'tonos': {
      if (customization.gridSize === 9) {
        return rowMajorLayout(3, 3, TILE, 9);
      }
      return rowMajorLayout(1, 3, TILE, 3);
    }
  }

  // Exhaustiveness check
  const _exhaustive: never = customization;
  throw new Error(
    `[assemble-tiles] Unhandled category: ${(_exhaustive as { categoryType: string }).categoryType}`,
  );
}

function gridRowsCols(size: 3 | 4 | 6 | 9): { rows: number; cols: number } {
  switch (size) {
    case 3: return { rows: 1, cols: 3 };
    case 4: return { rows: 2, cols: 2 };
    case 6: return { rows: 3, cols: 2 };
    case 9: return { rows: 3, cols: 3 };
  }
}

function rowMajorLayout(
  rows: number,
  cols: number,
  tileSize: number,
  tileCount: number,
): CompositeLayout {
  const tiles: TilePlacement[] = [];
  for (let i = 0; i < tileCount; i++) {
    const row = Math.floor(i / cols);
    const col = i % cols;
    tiles.push({
      index: i,
      left: col * tileSize,
      top: row * tileSize,
      width: tileSize,
      height: tileSize,
    });
  }
  return {
    width: cols * tileSize,
    height: rows * tileSize,
    tiles,
  };
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
