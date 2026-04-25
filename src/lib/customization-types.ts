import type { GridSize } from './grid-config';
import { CATEGORY_LAYOUTS } from './category-layouts';

// ─── Category identifiers ───────────────────────────────────────────────────

export type CategoryType =
  | 'mosaicos'
  | 'spotify'
  | 'tonos'
  | 'save-the-date'
  | 'arte'
  | 'studio'
  | 'polaroid';

// ─── Tonos intensity ────────────────────────────────────────────────────────

export type TonosIntensity = 'mild' | 'medium' | 'strong';

export type TonosToneColumn = 'warm' | 'none' | 'cool';

// ─── Tonos per-slot config (single source of truth) ────────────────────────

/**
 * How the user's photo fits inside its 827×827 print tile when the
 * source image's aspect doesn't match. Three modes match the Sharp
 * `fit` semantics (UI label → Sharp behaviour):
 *   - `'fill'`  — UI: cropper covers full tile, may crop edges → Sharp `fit: 'cover'`
 *   - `'fit'`   — UI: shows whole image, letterboxes empty space → Sharp `fit: 'contain'` + cream bg
 *   - `'stretch'` — UI: distorts to exact dimensions → Sharp `fit: 'fill'`
 */
export type TonosFitMode = 'fill' | 'fit' | 'stretch';

/** The four quarter-turns supported by the print pipeline. */
export type TonosRotation = 0 | 90 | 180 | 270;

/** Per-slot (one of three) fit + rotation user controls in the cropper. */
export interface TonosSlotConfig {
  fitMode: TonosFitMode;
  rotation: TonosRotation;
}

/**
 * Tonos always has exactly three uploaded slots (one per source photo),
 * regardless of grid size. Fixed-length tuple so consumers can reach
 * into a slot by index without conditional length checks. NOT marked
 * `readonly` because the builder's `setTonosFitMode` /
 * `setTonosRotation` setters do `next[index] = { ...prev[index], ... }`
 * during state updates; consumers that need an immutable view can use
 * `Readonly<TonosSlotConfigs>` locally.
 */
export type TonosSlotConfigs = [
  TonosSlotConfig,
  TonosSlotConfig,
  TonosSlotConfig,
];

// ─── Per-category customization data (discriminated union) ──────────────────

export interface MosaicosCustomization {
  categoryType: 'mosaicos';
  gridSize: 3 | 6 | 9;
  /**
   * True when the user rotated the grid (portrait ↔ landscape) in the
   * builder. Captured from `useBuilderFlow.layoutRotated` and threaded
   * through the cart so the print processor can swap rows/cols before
   * cropping + splitting. Rotation is a no-op on gridSize 9 (square).
   */
  layoutRotated?: boolean;
}

export interface SpotifyCustomization {
  categoryType: 'spotify';
  gridSize: 6;
  songName: string;
  artistName: string;
}

export interface TonosCustomization {
  categoryType: 'tonos';
  gridSize: 3 | 9;
  intensity: TonosIntensity;
  /**
   * Per-slot fit + rotation. Persisted in the cart, serialized into
   * Shopify line-item attributes, and read back at order time by the
   * webhook to drive the print processor's per-slot crop semantics.
   * Optional: pre-fitMode-fix payloads default the processor to
   * `[{fitMode:'fill', rotation:0}, ...]` for backward compat.
   */
  tonosSlots?: TonosSlotConfigs;
}

export type STDFontFamily =
  | 'cormorant' | 'playfair'
  | 'montserrat' | 'dm-sans'
  | 'dancing-script' | 'great-vibes'
  | 'cinzel' | 'tenor-sans';

export type STDAnchor =
  | 'top-left' | 'top-center' | 'top-right'
  | 'middle-left' | 'middle-center' | 'middle-right'
  | 'bottom-left' | 'bottom-center' | 'bottom-right';

export type STDSize = 'S' | 'M' | 'L';

export type STDTextTreatment = 'none' | 'shadow' | 'outline' | 'halo' | 'card' | 'frame';

export type STDTextIntensity = 'subtle' | 'medium' | 'intense';

export interface SaveTheDateCustomization {
  categoryType: 'save-the-date';
  gridSize: 9;
  eventText: string;
  date: string;
  fontFamily: STDFontFamily;
  fontSize: STDSize;
  color: string;
  anchor: STDAnchor;
  treatment: STDTextTreatment;
  intensity: STDTextIntensity;
}

export const STD_DEFAULTS = {
  fontFamily: 'cormorant' as STDFontFamily,
  fontSize: 'M' as STDSize,
  color: '#FFFFFF',
  anchor: 'top-center' as STDAnchor,
  treatment: 'shadow' as STDTextTreatment,
  intensity: 'medium' as STDTextIntensity,
};

/**
 * YIQ-based perceived luminance of a hex color. Returns 0–1.
 * Used to derive auto-contrast panel backgrounds for STD readability treatments.
 */
export function hexLuminance(hex: string): number {
  const clean = hex.replace('#', '');
  if (clean.length !== 3 && clean.length !== 6) return 0.5;
  const expanded = clean.length === 3
    ? clean.split('').map((c) => c + c).join('')
    : clean;
  const r = parseInt(expanded.slice(0, 2), 16);
  const g = parseInt(expanded.slice(2, 4), 16);
  const b = parseInt(expanded.slice(4, 6), 16);
  return (r * 0.299 + g * 0.587 + b * 0.114) / 255;
}

export const STD_FONT_CSS_VARS: Record<STDFontFamily, string> = {
  cormorant: 'var(--font-cormorant), "Cormorant Garamond", Georgia, serif',
  playfair: 'var(--font-playfair), "Playfair Display", Georgia, serif',
  montserrat: 'var(--font-montserrat), Montserrat, sans-serif',
  'dm-sans': 'var(--font-dm-sans), "DM Sans", sans-serif',
  'dancing-script': 'var(--font-dancing-script), "Dancing Script", cursive',
  'great-vibes': 'var(--font-great-vibes), "Great Vibes", cursive',
  cinzel: 'var(--font-cinzel), Cinzel, Georgia, serif',
  'tenor-sans': 'var(--font-tenor-sans), "Tenor Sans", sans-serif',
};

// Single-quoted family names are safe to interpolate into SVG
// `font-family="..."` attributes; double-quoted family names would
// collide with the outer attribute delimiter and break SVG parsing in
// libvips / librsvg at render time.
export const STD_FONT_PRINT_NAMES: Record<STDFontFamily, string> = {
  cormorant: "'Cormorant Garamond', Georgia, serif",
  playfair: "'Playfair Display', Georgia, serif",
  montserrat: 'Montserrat, sans-serif',
  'dm-sans': "'DM Sans', sans-serif",
  'dancing-script': "'Dancing Script', cursive",
  'great-vibes': "'Great Vibes', cursive",
  cinzel: 'Cinzel, Georgia, serif',
  'tenor-sans': "'Tenor Sans', sans-serif",
};

export const STD_COLOR_PALETTE: ReadonlyArray<{ hex: string; nameKey: string }> = [
  { hex: '#FFFFFF', nameKey: 'colorWhite' },
  { hex: '#000000', nameKey: 'colorBlack' },
  { hex: '#F5EEDB', nameKey: 'colorCream' },
  { hex: '#C4A875', nameKey: 'colorChampagne' },
  { hex: '#C15F3C', nameKey: 'colorTerracotta' },
  { hex: '#C89397', nameKey: 'colorDustyRose' },
  { hex: '#1D2B53', nameKey: 'colorNavy' },
  { hex: '#2E4030', nameKey: 'colorForest' },
];

export interface ArteCustomization {
  categoryType: 'arte';
  gridSize: 9;
  title: string;
  artist: string;
  year: string;
}

export interface StudioCustomization {
  categoryType: 'studio';
  gridSize: 6;
  year: string;
  japaneseText: string;
  customText: string;
  studioText: string;
}

export interface PolaroidCustomization {
  categoryType: 'polaroid';
  gridSize: 4;
}

export type CategoryCustomization =
  | MosaicosCustomization
  | SpotifyCustomization
  | TonosCustomization
  | SaveTheDateCustomization
  | ArteCustomization
  | StudioCustomization
  | PolaroidCustomization;

// ─── Category metadata (what each category supports) ────────────────────────

export interface CategoryMeta {
  type: CategoryType;
  label: string;
  allowedGridSizes: GridSize[];
  textFields: string[];
  hasTheme: boolean;
  description: string;
}

export const CATEGORY_REGISTRY: Record<CategoryType, CategoryMeta> = {
  mosaicos: {
    type: 'mosaicos',
    label: 'Mosaicos',
    allowedGridSizes: [9, 6, 3],
    textFields: [],
    hasTheme: false,
    description: 'Basic photo split across tiles',
  },
  spotify: {
    type: 'spotify',
    label: 'Spotify',
    allowedGridSizes: [6],
    textFields: ['songName', 'artistName'],
    hasTheme: false,
    description: 'Spotify-style with song info bar',
  },
  tonos: {
    type: 'tonos',
    label: 'Tonos',
    allowedGridSizes: [9, 3],
    textFields: [],
    hasTheme: false,
    description: 'Three photos with warm/cool tone columns',
  },
  'save-the-date': {
    type: 'save-the-date',
    label: 'Save the Date',
    allowedGridSizes: [9],
    textFields: ['eventText', 'date'],
    hasTheme: false,
    description: 'Photo with text overlay for events',
  },
  arte: {
    type: 'arte',
    label: 'Arte',
    allowedGridSizes: [9],
    textFields: ['title', 'artist', 'year'],
    hasTheme: false,
    description: 'Artwork split with info tile',
  },
  studio: {
    type: 'studio',
    label: 'Studio',
    allowedGridSizes: [6],
    textFields: ['year', 'studioText', 'japaneseText', 'customText'],
    hasTheme: false,
    description: 'Film-poster style with text panels',
  },
  polaroid: {
    type: 'polaroid',
    label: 'Polaroid',
    allowedGridSizes: [4],
    textFields: [],
    hasTheme: false,
    description: 'Photos inside white Polaroid frame',
  },
};

// ─── Tile layout descriptors ────────────────────────────────────────────────

export type TileRole = 'photo' | 'special' | 'text-panel';

export interface TileDescriptor {
  index: number;
  role: TileRole;
  label?: string;
  gridColumn?: number;  // grid-column-start (for non-standard placement)
  gridRow?: number;     // grid-row-start
  // Tonos-only metadata: which uploaded image and which tone column this tile belongs to.
  sourceImageIndex?: 0 | 1 | 2;
  toneColumn?: TonosToneColumn;
}

/**
 * Returns the tile layout for a given category customization.
 *
 * Adapter: the canonical layout data lives in `src/lib/category-layouts/`.
 * This function translates each category's `LayoutTile` descriptors into
 * the historical flat shape existing consumers expect. PR 1b migrates
 * consumers to the new contract and deletes this compatibility layer.
 */
export function getTileLayout(config: CategoryCustomization): TileDescriptor[] {
  const layout = CATEGORY_LAYOUTS[config.categoryType];
  const tiles = layout.tiles[config.gridSize];
  if (!tiles) {
    throw new Error(
      `[customization-types] getTileLayout: ${config.categoryType} has no tiles for grid ${config.gridSize}`,
    );
  }
  return tiles.map((tile): TileDescriptor => {
    // Category-specific meta is a discriminated union; the old flat shape
    // exposes every field as top-level optional. Probe with an index access
    // so categories that don't have a given field just return undefined.
    const meta = tile.meta as
      | { label?: string; sourceImageIndex?: 0 | 1 | 2; toneColumn?: TonosToneColumn }
      | undefined;
    const out: TileDescriptor = { index: tile.index, role: tile.role };
    if (meta?.label !== undefined) out.label = meta.label;
    if (tile.col !== undefined) out.gridColumn = tile.col;
    if (tile.row !== undefined) out.gridRow = tile.row;
    if (meta?.sourceImageIndex !== undefined) out.sourceImageIndex = meta.sourceImageIndex;
    if (meta?.toneColumn !== undefined) out.toneColumn = meta.toneColumn;
    return out;
  });
}
