import type { GridSize } from './grid-config';

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

// ─── Per-category customization data (discriminated union) ──────────────────

export interface MosaicosCustomization {
  categoryType: 'mosaicos';
  gridSize: 3 | 6 | 9;
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

export interface SaveTheDateCustomization {
  categoryType: 'save-the-date';
  gridSize: 9;
  eventText: string;
  date: string;
  fontFamily: STDFontFamily;
  fontSize: STDSize;
  color: string;
  anchor: STDAnchor;
}

export const STD_DEFAULTS = {
  fontFamily: 'cormorant' as STDFontFamily,
  fontSize: 'M' as STDSize,
  color: '#FFFFFF',
  anchor: 'top-center' as STDAnchor,
};

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

export const STD_FONT_PRINT_NAMES: Record<STDFontFamily, string> = {
  cormorant: '"Cormorant Garamond", Georgia, serif',
  playfair: '"Playfair Display", Georgia, serif',
  montserrat: 'Montserrat, sans-serif',
  'dm-sans': '"DM Sans", sans-serif',
  'dancing-script': '"Dancing Script", cursive',
  'great-vibes': '"Great Vibes", cursive',
  cinzel: 'Cinzel, Georgia, serif',
  'tenor-sans': '"Tenor Sans", sans-serif',
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

const TONOS_COLUMNS: readonly TonosToneColumn[] = ['warm', 'none', 'cool'];

/**
 * Returns the tile layout for a given category customization.
 * Describes which tiles are photo tiles, special tiles, or text panels.
 */
export function getTileLayout(config: CategoryCustomization): TileDescriptor[] {
  const { categoryType, gridSize } = config;

  switch (categoryType) {
    case 'mosaicos':
    case 'polaroid':
      return Array.from({ length: gridSize }, (_, i) => ({
        index: i,
        role: 'photo' as const,
      }));

    case 'spotify':
      // 6-grid: top 4 = photo (2x2), bottom 2 = black bar
      return [
        { index: 0, role: 'photo' },
        { index: 1, role: 'photo' },
        { index: 2, role: 'photo' },
        { index: 3, role: 'photo' },
        { index: 4, role: 'special', label: 'spotify-bar-left' },
        { index: 5, role: 'special', label: 'spotify-bar-right' },
      ];

    case 'tonos':
      // Rows = uploaded picture, columns = tone (warm/none/cool).
      // 9-grid: 3 rows × 3 cols, sourceImageIndex = row.
      // 3-grid: 1 row × 3 cols, sourceImageIndex = column (one picture per tile).
      if (gridSize === 9) {
        return Array.from({ length: 9 }, (_, i) => ({
          index: i,
          role: 'photo' as const,
          sourceImageIndex: Math.floor(i / 3) as 0 | 1 | 2,
          toneColumn: TONOS_COLUMNS[i % 3],
        }));
      }
      return Array.from({ length: 3 }, (_, i) => ({
        index: i,
        role: 'photo' as const,
        sourceImageIndex: i as 0 | 1 | 2,
        toneColumn: TONOS_COLUMNS[i],
      }));

    case 'save-the-date':
      // All tiles are photo tiles (with text overlay)
      return Array.from({ length: gridSize }, (_, i) => ({
        index: i,
        role: 'photo' as const,
      }));

    case 'arte':
      // 4×2+1 layout: 8 photo tiles in 2 rows of 4, info tile at row 3 col 4
      return [
        ...Array.from({ length: 8 }, (_, i) => ({
          index: i,
          role: 'photo' as const,
        })),
        { index: 8, role: 'special', label: 'arte-info', gridColumn: 4, gridRow: 3 },
      ];

    case 'studio':
      // 6-grid: top 4 = photo (2x2), bottom 2 = text panels
      return [
        { index: 0, role: 'photo' },
        { index: 1, role: 'photo' },
        { index: 2, role: 'photo' },
        { index: 3, role: 'photo' },
        { index: 4, role: 'text-panel', label: 'studio-left' },
        { index: 5, role: 'text-panel', label: 'studio-right' },
      ];
  }
}
