/**
 * Pure derivation helpers that translate a `CategoryLayout` into the formats
 * each consumer needs: CSS percentages for client preview, scaled pixels for
 * server processors, composite placements for the print pipeline, and
 * cropper overlay props for the builder.
 *
 * All functions are deterministic and side-effect free.
 */
import type { CategoryCustomization, CategoryType } from '../customization-types';
import { GRID_CONFIGS, type GridSize } from '../grid-config';
import type {
  CategoryLayout,
  CropperOverlay,
  LayoutTile,
  PhotoInputMode,
  PhotoRegion,
} from './types';
import { CATEGORY_LAYOUTS } from './index';

// ─── Helpers ────────────────────────────────────────────────────────────────

function requireDimensions(
  layout: CategoryLayout,
  grid: GridSize,
): { rows: number; cols: number } {
  const dim = layout.dimensions[grid];
  if (!dim) {
    throw new Error(
      `[category-layouts] ${layout.type} has no dimensions for grid ${grid}`,
    );
  }
  return dim;
}

function requireTiles(
  layout: CategoryLayout,
  grid: GridSize,
): readonly LayoutTile[] {
  const tiles = layout.tiles[grid];
  if (!tiles) {
    throw new Error(
      `[category-layouts] ${layout.type} has no tiles for grid ${grid}`,
    );
  }
  return tiles;
}

function requireFrame(layout: CategoryLayout) {
  if (!layout.frame) {
    throw new Error(
      `[category-layouts] ${layout.type} has no frame; cannot derive photo region`,
    );
  }
  return layout.frame;
}

// ─── Photo input mode (UAT-1b) ─────────────────────────────────────────────

/**
 * Number of photos the user uploads for this (category, grid). 1 for
 * single-photo flows, 3 for multi-photo flows (Tonos, STD-3). Grid-keyed
 * because Save the Date is mixed (9/6 = 1, 3 = 3) — call this helper
 * rather than inspect the layout map directly.
 */
export function deriveUploadSlots(
  layout: CategoryLayout,
  grid: GridSize,
): 1 | 3 {
  return layout.uploadSlots[grid] ?? 1;
}

/**
 * Whether the (category, grid) combination is single-photo or multi-photo.
 * The builder flow, cart serializer, cart-composite endpoint, webhook
 * processor, and print pipeline all branch on this — NOT on
 * `category === 'tonos'`. That keeps Save the Date 3-piece reusing the
 * multi-photo flow without inheriting Tonos's tone/intensity effects.
 */
export function derivePhotoInput(
  layout: CategoryLayout,
  grid: GridSize,
): PhotoInputMode {
  return layout.photoInputMode[grid] ?? 'single';
}

export function isMultiPhotoInput(
  layout: CategoryLayout,
  grid: GridSize,
): boolean {
  return derivePhotoInput(layout, grid) === 'multi-photo';
}

// ─── Crop aspect ────────────────────────────────────────────────────────────

/**
 * Returns the crop-stage aspect ratio (width / height) the cropper should use.
 * Falls back to `GRID_CONFIGS[grid].aspect` for categories without an
 * override (mosaicos, tonos, save-the-date).
 */
export function deriveCropAspect(
  layout: CategoryLayout,
  grid: GridSize,
): number {
  return layout.cropAspect[grid] ?? GRID_CONFIGS[grid].aspect;
}

// ─── Dimensions ─────────────────────────────────────────────────────────────

/**
 * Returns the effective rows × cols for a layout + grid combination. Uses
 * the layout override when present; falls back to `GRID_CONFIGS[grid]`
 * otherwise.
 */
export function deriveDimensions(
  layout: CategoryLayout,
  grid: GridSize,
): { rows: number; cols: number } {
  const dim = layout.dimensions[grid];
  if (dim) return dim;
  const base = GRID_CONFIGS[grid];
  return { rows: base.rows, cols: base.cols };
}

// ─── Tile descriptors ───────────────────────────────────────────────────────

export function deriveTiles(
  layout: CategoryLayout,
  grid: GridSize,
): readonly LayoutTile[] {
  return requireTiles(layout, grid);
}

// ─── Cropper overlay ────────────────────────────────────────────────────────

export function deriveCropperOverlay(
  layout: CategoryLayout,
  grid: GridSize,
): CropperOverlay | null {
  return layout.cropperOverlay[grid] ?? null;
}

// ─── Photo regions (frame-based: Polaroid, Studio) ──────────────────────────

export interface ClientInset {
  /** CSS `left` percentage, 0..100. */
  left: number;
  /** CSS `top` percentage, 0..100. */
  top: number;
  /** CSS `width` percentage, 0..100. */
  width: number;
  /** CSS `height` percentage, 0..100. */
  height: number;
}

/**
 * Derive the CSS-% inset for the image element inside a frame tile. The
 * result is the region of the tile (viewed as a unit square) into which the
 * photo extends so the PNG cutout lines up.
 *
 * Each tile is a 1:1 container; the image is anchored at the cutout's
 * top-left and stretches to fill the part of the tile the frame leaves
 * transparent. `width` and `height` are derived from `right - left` and
 * `bottom - top` in the source PNG space.
 */
export function deriveClientInset(
  layout: CategoryLayout,
  tileIndex: number,
): ClientInset | null {
  if (!layout.frame) return null;
  const region = layout.frame.photo.tiles[tileIndex];
  if (!region) return null;
  const { sourceSize } = layout.frame.photo;
  return {
    left: (region.left / sourceSize) * 100,
    top: (region.top / sourceSize) * 100,
    width: ((region.right - region.left) / sourceSize) * 100,
    height: ((region.bottom - region.top) / sourceSize) * 100,
  };
}

/**
 * Derive the per-tile photo region in print-pixel space, scaled from the
 * template PNG's native size to the requested tile size (usually
 * `TILE_PRINT_SIZE`, i.e. 827 px).
 */
export interface PrintRegion {
  left: number;
  top: number;
  width: number;
  height: number;
}

export function derivePrintRegion(
  layout: CategoryLayout,
  tileIndex: number,
  tileSize: number,
): PrintRegion | null {
  if (!layout.frame) return null;
  const region = layout.frame.photo.tiles[tileIndex];
  if (!region) return null;
  const { sourceSize } = layout.frame.photo;
  const scale = tileSize / sourceSize;
  return {
    left: Math.round(region.left * scale),
    top: Math.round(region.top * scale),
    width: Math.round((region.right - region.left) * scale),
    height: Math.round((region.bottom - region.top) * scale),
  };
}

/**
 * Returns the photo-region struct for the given category, or null for
 * frame-less categories. Callers use this to drive their own per-tile
 * extraction math (e.g. Polaroid / Studio processors scale the whole
 * visible area and extract each tile's strip).
 */
export function derivePhotoRegion(
  layout: CategoryLayout,
): PhotoRegion | null {
  return layout.frame ? layout.frame.photo : null;
}

// ─── Composite layout (server) ──────────────────────────────────────────────

export interface TilePlacementLayout {
  index: number;
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface CompositeLayoutResult {
  width: number;
  height: number;
  tiles: TilePlacementLayout[];
}

/**
 * Derive tile placements for the assembled composite canvas. Tiles without
 * explicit row/col placement fall back to row-major (`index % cols`,
 * `floor(index/cols)`). Explicit row/col (1-indexed) lets Arte put tile 8
 * at (row=3, col=4) without breaking the row-major default for tiles 0-7.
 */
export function deriveCompositeLayout(
  layout: CategoryLayout,
  grid: GridSize,
  tileSize: number,
): CompositeLayoutResult {
  const { rows, cols } = requireDimensions(layout, grid);
  const tiles = requireTiles(layout, grid);
  const placements: TilePlacementLayout[] = tiles.map((tile) => {
    const rowIdx = tile.row !== undefined
      ? tile.row - 1
      : Math.floor(tile.index / cols);
    const colIdx = tile.col !== undefined
      ? tile.col - 1
      : tile.index % cols;
    return {
      index: tile.index,
      left: colIdx * tileSize,
      top: rowIdx * tileSize,
      width: tileSize,
      height: tileSize,
    };
  });
  return {
    width: cols * tileSize,
    height: rows * tileSize,
    tiles: placements,
  };
}

// ─── Convenience: get layout for a customization ────────────────────────────

export function layoutFor(customization: CategoryCustomization): CategoryLayout {
  return CATEGORY_LAYOUTS[customization.categoryType];
}

export function layoutForType(category: CategoryType): CategoryLayout {
  return CATEGORY_LAYOUTS[category];
}

// ─── Internal ───────────────────────────────────────────────────────────────

export const __internal = { requireFrame };
