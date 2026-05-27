/**
 * Product layout contract — the single source of truth for every per-category
 * geometry decision the app makes.
 *
 * Before this contract existed, the same layout knowledge was redefined across
 * ≥5 files: `grid-config.ts` crop overrides, `customization-types.ts`
 * `getTileLayout()` switch, `MagnetBuilder.tsx` cropper-overlay switch,
 * `MagnetPreview.tsx` Polaroid/Studio CSS-% insets, `assemble-tiles.ts`
 * `getCompositeLayout()` switch, and per-processor `PHOTO_AREAS` arrays. This
 * module declares the shape; `derive.ts` provides the pure functions that
 * translate it into the formats each consumer needs (CSS percentages, server
 * pixels, cropper overlay props, composite placements).
 */
import type { GridSize } from '../grid-config';
import type {
  CategoryType,
  TileRole,
  TonosToneColumn,
} from '../customization-types';

// ─── Tile descriptor ────────────────────────────────────────────────────────

/**
 * Category-specific tile metadata. Tonos has true per-tile metadata (tone
 * column + source image index); Save the Date 3-piece uses
 * `sourceImageIndex` to map each photo slot to its tile (without tone
 * effects). Everything else uses labels that describe a tile's visual
 * role (e.g. which corner of the Spotify bar it is).
 */
export type CategoryTileMeta = {
  mosaicos: Record<string, never>;
  spotify: { label?: 'spotify-bar-left' | 'spotify-bar-right' };
  tonos: { sourceImageIndex: 0 | 1 | 2; toneColumn: TonosToneColumn };
  studio: { label?: 'studio-left' | 'studio-right' };
  arte: { label?: 'arte-info' };
  polaroid: Record<string, never>;
  'save-the-date': { sourceImageIndex?: 0 | 1 | 2 };
};

export interface LayoutTile<C extends CategoryType = CategoryType> {
  index: number;
  role: TileRole;
  /**
   * 1-indexed grid placement. When absent, row-major placement is assumed
   * using the category's `dimensions[grid]`. Decoupled from CSS grid-row /
   * grid-column to keep the data layer renderer-agnostic.
   */
  row?: number;
  col?: number;
  meta?: CategoryTileMeta[C];
}

// ─── Frame & photo region (Polaroid, Studio) ────────────────────────────────

/**
 * Per-tile photo region for frame-based categories.
 *
 * Coordinates are in the template PNG's native pixel space (`sourceSize`).
 * Derivation helpers translate these into:
 *   - CSS % insets (for client preview)
 *   - scaled pixels (for server processors at `TILE_PRINT_SIZE`)
 */
export interface PhotoRegion {
  /** Template PNG native size in pixels (square assumption). */
  sourceSize: number;
  /** Per-tile cutout, in `sourceSize` pixels. */
  tiles: Record<number, { left: number; top: number; right: number; bottom: number }>;
  /**
   * Optional: photo strip height that extends into non-photo tiles (Studio
   * has a 63-px strip of photo extending from tiles 3-4 into tiles 5-6 on
   * top of the text-panel backgrounds).
   */
  photoStripHeight?: number;
}

export interface Frame {
  /** Absolute URL path under /public (client) or relative dir (server). */
  templateDir: string;
  photo: PhotoRegion;
}

// ─── Overlays composited OVER tiles (not inside a frame) ────────────────────

export type OverlaySpec =
  /** STD composes text over the cropped photo before tile split. */
  | { kind: 'save-the-date-text' }
  /** Arte info tile rendered into tile index 8. */
  | { kind: 'arte-info-tile' }
  /** Spotify bar rendered into tiles 4 + 5 from separate template PNGs. */
  | { kind: 'spotify-bar' }
  /** Studio text panels rendered into tiles 4 + 5. */
  | { kind: 'studio-text-panels' };

// ─── Cropper guide overlay (client-only) ────────────────────────────────────

export interface CropperOverlay {
  /** Number of overlay rows drawn over the cropper. Omit when rowSplits set. */
  rows?: number;
  /** Number of overlay cols drawn over the cropper. */
  cols?: number;
  /**
   * Explicit row split percentages (0..100) for non-uniform previews.
   * Polaroid: [55.96]; Studio: [43.69, 94.77].
   */
  rowSplits?: number[];
}

// ─── Photo input mode (per-grid) ────────────────────────────────────────────

/**
 * How many photos the user brings to the builder for a given (category, grid)
 * combination. Single-photo flows split one cropped photo across all tiles
 * (Mosaicos, Studio, Arte, Spotify, Polaroid, STD-9, STD-6). Multi-photo flows
 * accept one photo per tile (Tonos 3/9, STD-3).
 *
 * UAT-1b made this per-grid because Save the Date is mixed: 9/6 are single-
 * photo, 3 is multi-photo. Use `derivePhotoInput(layout, grid)` to read it;
 * don't inspect the map directly.
 */
export type PhotoInputMode = 'single' | 'multi-photo';

// ─── The full per-category layout ───────────────────────────────────────────

export interface CategoryLayout<C extends CategoryType = CategoryType> {
  type: C;
  /**
   * Photo upload slots per grid size. Single-photo flows are `1`; multi-photo
   * flows are `3`. Grid-keyed because Save the Date is mixed (9/6 = 1, 3 = 3).
   * Consumers should call `deriveUploadSlots(layout, grid)` — don't read the
   * map directly.
   */
  uploadSlots: Partial<Record<GridSize, 1 | 3>>;
  /**
   * Photo input mode per grid size — single-photo or multi-photo. Replaces
   * the prior implicit category-string branching (e.g. `category === 'tonos'`).
   * Call `derivePhotoInput(layout, grid)` to read.
   */
  photoInputMode: Partial<Record<GridSize, PhotoInputMode>>;
  /**
   * Whether the cropper aspect can be flipped (landscape↔portrait).
   * False for categories with a frame / fixed aspect override. UAT-1b
   * enabled this for Save the Date so STD-6 and STD-3 can rotate
   * portrait↔landscape; STD-9 rotation is a no-op (square grid).
   */
  rotatable: boolean;
  /** Grid rows × cols per allowed grid size. */
  dimensions: Partial<Record<GridSize, { rows: number; cols: number }>>;
  /** Crop-stage aspect ratio (w/h) per size. Falls back to GRID_CONFIGS. */
  cropAspect: Partial<Record<GridSize, number>>;
  /** Tile descriptors per size. */
  tiles: Partial<Record<GridSize, readonly LayoutTile<C>[]>>;
  /** Cropper overlay guide per size; `null` = no overlay grid. */
  cropperOverlay: Partial<Record<GridSize, CropperOverlay | null>>;
  /** Frame PNG (Polaroid / Studio); `null` for frame-less categories. */
  frame: Frame | null;
  /** Overlays composited over tiles (STD text, Arte info, Spotify/Studio panels). */
  overlays: readonly OverlaySpec[];
}
