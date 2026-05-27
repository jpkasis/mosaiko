import { CATEGORY_REGISTRY, type CategoryType } from './customization-types';
import { GRID_CONFIGS, type GridSize } from './grid-config';

// ─── Catalog product type ────────────────────────────────────────────────────

export interface SeamData {
  vertical: number[];       // normalized 0-1 seam center positions (x)
  horizontal: number[];     // normalized 0-1 seam center positions (y)
  widthPercent: number;     // seam width as fraction (e.g., 0.005 = 0.5%)
}

export interface CatalogProduct {
  id: string;
  category: CategoryType;
  name: string;
  price: number;
  image: string;
  pieces: number;
  grid: string;       // display: "3x3", "2x3"
  gridSize: GridSize;  // numeric: 3, 4, 6, 9
  originalImage: string;   // path to high-res source in _originals/
  seamData?: SeamData;     // pixel-precise seam positions for tile rendering
}

// `isPredesigned` was removed in UAT-1a (2026-05-22): the purchase
// mode is now category-level. Use `isPurchasableAsIs(category)` from
// `./catalog-purchase-mode.ts` to ask whether a product is bought
// as-shown (Studio/Arte) or surfaces the builder (everything else).

// ─── Products ────────────────────────────────────────────────────────────────

export const PRODUCTS: CatalogProduct[] = [
  // Mosaicos — builder-only (user uploads their own photo)
  { id: 'mos-1', category: 'mosaicos', name: 'Mosaico Familiar 3x3', price: 480, image: '/products/mosaicos/familiar-9.png', pieces: 9, grid: '3x3', gridSize: 9, originalImage: '/products/_originals/mosaicos/familiar-9.png', seamData: { vertical: [0.338265, 0.661224], horizontal: [0.339295, 0.66326], widthPercent: 0.006509 } },
  { id: 'mos-2', category: 'mosaicos', name: 'Mosaico Pareja 2x3', price: 360, image: '/products/mosaicos/pareja-6.png', pieces: 6, grid: '2x3', gridSize: 6, originalImage: '/products/_originals/mosaicos/pareja-6.png', seamData: { vertical: [0.498871], horizontal: [0.334696, 0.657128], widthPercent: 0.005806 } },
  { id: 'mos-3', category: 'mosaicos', name: 'Mosaico Panoramico', price: 200, image: '/products/mosaicos/panoramico-3.png', pieces: 3, grid: '3x1', gridSize: 3, originalImage: '/products/_originals/mosaicos/panoramico-3.png', seamData: { vertical: [0.338265, 0.658673], horizontal: [], widthPercent: 0.006888 } },
  { id: 'mos-4', category: 'mosaicos', name: 'Mosaico Mascota', price: 360, image: '/products/mosaicos/mascota-6.png', pieces: 6, grid: '3x2', gridSize: 6, originalImage: '/products/_originals/mosaicos/mascota-6.png', seamData: { vertical: [0.338776, 0.662245], horizontal: [0.491704], widthPercent: 0.007971 } },
  { id: 'mos-5', category: 'mosaicos', name: 'Mosaico Recuerdo', price: 480, image: '/products/mosaicos/familiar-9-2.png', pieces: 9, grid: '3x3', gridSize: 9, originalImage: '/products/_originals/mosaicos/familiar-9-2.png', seamData: { vertical: [0.338776, 0.661735], horizontal: [0.339295, 0.66326], widthPercent: 0.007147 } },
  { id: 'mos-6', category: 'mosaicos', name: 'Mosaico Tira', price: 200, image: '/products/mosaicos/panoramico-3-2.png', pieces: 3, grid: '1x3', gridSize: 3, originalImage: '/products/_originals/mosaicos/panoramico-3-2.png', seamData: { vertical: [], horizontal: [0.337251, 0.662238], widthPercent: 0.004854 } },
  // Studio
  { id: 'stu-1', category: 'studio', name: 'El Viaje de Chihiro', price: 480, image: '/products/studio/chihiro.png', pieces: 6, grid: '2x3', gridSize: 6, originalImage: '/products/_originals/studio/chihiro.png', seamData: { vertical: [0.5], horizontal: [0.33894, 0.66157], widthPercent: 0.009202 } },
  { id: 'stu-2', category: 'studio', name: 'Mi Vecino Totoro', price: 480, image: '/products/studio/totoro.png', pieces: 6, grid: '2x3', gridSize: 6, originalImage: '/products/_originals/studio/totoro.png', seamData: { vertical: [0.502259], horizontal: [0.33894, 0.66157], widthPercent: 0.007696 } },
  { id: 'stu-3', category: 'studio', name: 'Princesa Mononoke', price: 480, image: '/products/studio/mononoke.png', pieces: 6, grid: '2x3', gridSize: 6, originalImage: '/products/_originals/studio/mononoke.png', seamData: { vertical: [0.500753], horizontal: [0.33894, 0.66157], widthPercent: 0.009623 } },
  { id: 'stu-4', category: 'studio', name: 'El Castillo Vagabundo', price: 480, image: '/products/studio/howl.png', pieces: 6, grid: '2x3', gridSize: 6, originalImage: '/products/_originals/studio/howl.png', seamData: { vertical: [0.502259], horizontal: [0.33894, 0.66157], widthPercent: 0.007526 } },
  { id: 'stu-5', category: 'studio', name: 'El Viaje de Chihiro II', price: 480, image: '/products/studio/chihiro-2.png', pieces: 6, grid: '2x3', gridSize: 6, originalImage: '/products/_originals/studio/chihiro-2.png', seamData: { vertical: [0.501506], horizontal: [0.33843, 0.66157], widthPercent: 0.008279 } },
  { id: 'stu-6', category: 'studio', name: 'Kiki Entregas a Domicilio', price: 480, image: '/products/studio/kiki.png', pieces: 6, grid: '2x3', gridSize: 6, originalImage: '/products/_originals/studio/kiki.png', seamData: { vertical: [0.500753], horizontal: [0.33894, 0.66157], widthPercent: 0.009453 } },
  { id: 'stu-7', category: 'studio', name: 'Ponyo', price: 480, image: '/products/studio/ponyo.png', pieces: 6, grid: '2x3', gridSize: 6, originalImage: '/products/_originals/studio/ponyo.png', seamData: { vertical: [0.500753], horizontal: [0.33894, 0.66157], widthPercent: 0.009453 } },
  { id: 'stu-8', category: 'studio', name: 'El Nino y la Garza', price: 480, image: '/products/studio/garza.png', pieces: 6, grid: '2x3', gridSize: 6, originalImage: '/products/_originals/studio/garza.png', seamData: { vertical: [0.500753], horizontal: [0.33894, 0.66157], widthPercent: 0.009453 } },
  // Arte (4x3 visual grid, 9 pieces: 8 art tiles + 1 info tile at row 3 col 4)
  { id: 'art-1', category: 'arte', name: 'La Noche Estrellada', price: 480, image: '/products/arte/noche-estrellada.png', pieces: 9, grid: '4x3', gridSize: 9, originalImage: '/products/_originals/arte/noche-estrellada.png', seamData: { vertical: [0.255015, 0.498843, 0.743441], horizontal: [0.338619, 0.682864], widthPercent: 0.014036 } },
  { id: 'art-2', category: 'arte', name: 'La Mona Lisa', price: 480, image: '/products/arte/mona-lisa.png', pieces: 9, grid: '4x3', gridSize: 9, originalImage: '/products/_originals/arte/mona-lisa.png', seamData: { vertical: [0.255015, 0.498843, 0.743441], horizontal: [0.338619, 0.641432], widthPercent: 0.010506 } },
  { id: 'art-3', category: 'arte', name: 'El Beso — Klimt', price: 480, image: '/products/arte/el-beso.png', pieces: 9, grid: '4x3', gridSize: 9, originalImage: '/products/_originals/arte/el-beso.png', seamData: { vertical: [0.253858, 0.498071, 0.743056], horizontal: [0.332992, 0.652174], widthPercent: 0.00577 } },
  { id: 'art-4', category: 'arte', name: 'La Gran Ola', price: 480, image: '/products/arte/gran-ola.png', pieces: 9, grid: '4x3', gridSize: 9, originalImage: '/products/_originals/arte/gran-ola.png', seamData: { vertical: [0.253858, 0.498071, 0.743056], horizontal: [0.334015, 0.652174], widthPercent: 0.00536 } },
  { id: 'art-5', category: 'arte', name: 'La Joven de la Perla', price: 480, image: '/products/arte/joven-perla.png', pieces: 9, grid: '4x3', gridSize: 9, originalImage: '/products/_originals/arte/joven-perla.png', seamData: { vertical: [0.255015, 0.498843, 0.743056], horizontal: [0.338619, 0.682864], widthPercent: 0.014036 } },
  { id: 'art-6', category: 'arte', name: 'Las Dos Fridas', price: 480, image: '/products/arte/dos-fridas.png', pieces: 9, grid: '4x3', gridSize: 9, originalImage: '/products/_originals/arte/dos-fridas.png', seamData: { vertical: [0.253858, 0.498071, 0.743056], horizontal: [0.335038, 0.653197], widthPercent: 0.004619 } },
  { id: 'art-7', category: 'arte', name: 'Nenufares — Monet', price: 480, image: '/products/arte/nenufares.png', pieces: 9, grid: '4x3', gridSize: 9, originalImage: '/products/_originals/arte/nenufares.png', seamData: { vertical: [0.253858, 0.498071, 0.743441], horizontal: [0.335038, 0.641432], widthPercent: 0.009325 } },
  { id: 'art-8', category: 'arte', name: 'El Nacimiento de Venus', price: 480, image: '/products/arte/venus.png', pieces: 9, grid: '4x3', gridSize: 9, originalImage: '/products/_originals/arte/venus.png', seamData: { vertical: [0.255015, 0.498071, 0.743441], horizontal: [0.335038, 0.682864], widthPercent: 0.013164 } },
  // Save the Date — UAT-1b restored 6-piece (Compromiso) and 3-piece
  // (Baby Shower) once the builder gained STD-6 (3×2) single-photo and
  // STD-3 (3×1) multi-photo support. STD-3 reuses the multi-photo
  // upload + crop UI introduced by Tonos but exposes the SaveTheDate
  // text overlay tools instead of Tonos color effects.
  { id: 'std-1', category: 'save-the-date', name: 'Boda Elegante', price: 480, image: '/products/save-the-date/boda-9.png', pieces: 9, grid: '3x3', gridSize: 9, originalImage: '/products/_originals/save-the-date/boda-9.png', seamData: { vertical: [0.338265, 0.661224], horizontal: [0.339295, 0.66326], widthPercent: 0.006509 } },
  { id: 'std-2', category: 'save-the-date', name: 'Compromiso', price: 360, image: '/products/save-the-date/compromiso-6.png', pieces: 6, grid: '2x3', gridSize: 6, originalImage: '/products/_originals/save-the-date/compromiso-6.png', seamData: { vertical: [0.498871], horizontal: [0.333674, 0.656106], widthPercent: 0.007249 } },
  { id: 'std-3', category: 'save-the-date', name: 'Baby Shower', price: 200, image: '/products/save-the-date/baby-3.png', pieces: 3, grid: '1x3', gridSize: 3, originalImage: '/products/_originals/save-the-date/baby-3.png', seamData: { vertical: [], horizontal: [0.337251, 0.659683], widthPercent: 0.002555 } },
  // Tonos
  { id: 'ton-1', category: 'tonos', name: 'Ramo de Rosas', price: 480, image: '/products/tonos/rosas-9.png', pieces: 9, grid: '3x3', gridSize: 9, originalImage: '/products/_originals/tonos/rosas-9.png', seamData: { vertical: [0.333503, 0.655788], horizontal: [0.345262, 0.667339], widthPercent: 0.011781 } },
  { id: 'ton-2', category: 'tonos', name: 'Girasoles', price: 200, image: '/products/tonos/girasoles-3.png', pieces: 3, grid: '1x3', gridSize: 3, originalImage: '/products/_originals/tonos/girasoles-3.png', seamData: { vertical: [], horizontal: [0.345262, 0.667339], widthPercent: 0.012853 } },
  // Spotify
  { id: 'spo-1', category: 'spotify', name: 'Album Cover Custom', price: 480, image: '/products/spotify/album-1.png', pieces: 6, grid: '2x3', gridSize: 6, originalImage: '/products/_originals/spotify/album-1.png', seamData: { vertical: [0.499624], horizontal: [0.334694, 0.664286], widthPercent: 0.007414 } },
  { id: 'spo-2', category: 'spotify', name: 'Personalizado', price: 480, image: '/products/spotify/personalizado.png', pieces: 6, grid: '2x3', gridSize: 6, originalImage: '/products/_originals/spotify/personalizado.png', seamData: { vertical: [0.501881], horizontal: [0.335204, 0.663265], widthPercent: 0.004468 } },
  // Polaroid
  { id: 'pol-1', category: 'polaroid', name: 'Tu Foto Polaroid', price: 480, image: '/products/polaroid/clasico.png', pieces: 4, grid: '2x2', gridSize: 4, originalImage: '/products/_originals/polaroid/clasico.png', seamData: { vertical: [0.498871], horizontal: [0.501508], widthPercent: 0.010168 } },
  { id: 'pol-2', category: 'polaroid', name: 'Polaroid Vintage', price: 480, image: '/products/polaroid/vintage.png', pieces: 4, grid: '2x2', gridSize: 4, originalImage: '/products/_originals/polaroid/vintage.png', seamData: { vertical: [0.501881], horizontal: [0.496229], widthPercent: 0.003387 } },
];

// ─── Category display metadata ───────────────────────────────────────────────

export interface CatalogCategory {
  type: CategoryType;
  i18nKey: string;       // key under catalogPage.*
  accentColor: string;   // Tailwind bg class
  order: number;
  showPersonalizeCard: boolean; // false when products already include "tu foto" placeholders
}

// Lookup from kebab-case CategoryType to the camelCase i18n key used in catalogPage
const CATEGORY_I18N_MAP: Record<CategoryType, string> = {
  mosaicos: 'mosaicos',
  studio: 'studio',
  arte: 'arte',
  'save-the-date': 'saveTheDate',
  tonos: 'tonos',
  spotify: 'spotify',
  polaroid: 'polaroid',
};

export const CATEGORY_ACCENT: Record<CategoryType, string> = {
  mosaicos: 'bg-terracotta',
  studio: 'bg-charcoal',
  arte: 'bg-gold',
  'save-the-date': 'bg-terracotta-light',
  tonos: 'bg-terracotta',
  spotify: 'bg-gold-dark',
  polaroid: 'bg-warm-gray',
};

export const CATALOG_CATEGORIES: CatalogCategory[] = [
  { type: 'mosaicos', i18nKey: 'mosaicos', accentColor: 'bg-terracotta', order: 1, showPersonalizeCard: true },
  { type: 'studio', i18nKey: 'studio', accentColor: 'bg-charcoal', order: 2, showPersonalizeCard: true },
  { type: 'arte', i18nKey: 'arte', accentColor: 'bg-gold', order: 3, showPersonalizeCard: true },
  { type: 'save-the-date', i18nKey: 'saveTheDate', accentColor: 'bg-terracotta-light', order: 4, showPersonalizeCard: true },
  { type: 'tonos', i18nKey: 'tonos', accentColor: 'bg-terracotta', order: 5, showPersonalizeCard: true },
  { type: 'spotify', i18nKey: 'spotify', accentColor: 'bg-gold-dark', order: 6, showPersonalizeCard: false },
  { type: 'polaroid', i18nKey: 'polaroid', accentColor: 'bg-warm-gray', order: 7, showPersonalizeCard: false },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function getProductById(id: string): CatalogProduct | undefined {
  return PRODUCTS.find((p) => p.id === id);
}

export function getProductsByCategory(): Map<CategoryType, CatalogProduct[]> {
  const map = new Map<CategoryType, CatalogProduct[]>();
  for (const cat of CATALOG_CATEGORIES) {
    map.set(cat.type, []);
  }
  for (const product of PRODUCTS) {
    const list = map.get(product.category);
    if (list) list.push(product);
  }
  return map;
}

export function getCategoryI18nKey(type: CategoryType): string {
  return CATEGORY_I18N_MAP[type];
}

export function formatPrice(price: number): string {
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: 'MXN',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(price);
}

// Async merge helpers (`getAllProducts` etc.) moved to
// `catalog-data.server.ts` so the static import graph of this file stays
// pure-data — Shopify Files / Sharp / storage code stays out of the
// client bundle.
