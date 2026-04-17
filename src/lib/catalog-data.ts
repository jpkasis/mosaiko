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
  isPredesigned: boolean;  // true = direct to preview, false = builder flow
  seamData?: SeamData;     // pixel-precise seam positions for tile rendering
}

// ─── Products ────────────────────────────────────────────────────────────────

export const PRODUCTS: CatalogProduct[] = [
  // Mosaicos — builder-only (user uploads their own photo)
  { id: 'mos-1', category: 'mosaicos', name: 'Mosaico Familiar 3x3', price: 480, image: '/products/mosaicos/familiar-9.png', pieces: 9, grid: '3x3', gridSize: 9, originalImage: '/products/_originals/mosaicos/familiar-9.png', isPredesigned: false, seamData: { vertical: [0.338265, 0.661224], horizontal: [0.339295, 0.66326], widthPercent: 0.006509 } },
  { id: 'mos-2', category: 'mosaicos', name: 'Mosaico Pareja 2x3', price: 360, image: '/products/mosaicos/pareja-6.png', pieces: 6, grid: '2x3', gridSize: 6, originalImage: '/products/_originals/mosaicos/pareja-6.png', isPredesigned: false, seamData: { vertical: [0.498871], horizontal: [0.334696, 0.657128], widthPercent: 0.005806 } },
  { id: 'mos-3', category: 'mosaicos', name: 'Mosaico Panoramico', price: 200, image: '/products/mosaicos/panoramico-3.png', pieces: 3, grid: '3x1', gridSize: 3, originalImage: '/products/_originals/mosaicos/panoramico-3.png', isPredesigned: false, seamData: { vertical: [0.338265, 0.658673], horizontal: [], widthPercent: 0.006888 } },
  { id: 'mos-4', category: 'mosaicos', name: 'Mosaico Mascota', price: 360, image: '/products/mosaicos/mascota-6.png', pieces: 6, grid: '3x2', gridSize: 6, originalImage: '/products/_originals/mosaicos/mascota-6.png', isPredesigned: false, seamData: { vertical: [0.338776, 0.662245], horizontal: [0.491704], widthPercent: 0.007971 } },
  { id: 'mos-5', category: 'mosaicos', name: 'Mosaico Recuerdo', price: 480, image: '/products/mosaicos/familiar-9-2.png', pieces: 9, grid: '3x3', gridSize: 9, originalImage: '/products/_originals/mosaicos/familiar-9-2.png', isPredesigned: false, seamData: { vertical: [0.338776, 0.661735], horizontal: [0.339295, 0.66326], widthPercent: 0.007147 } },
  { id: 'mos-6', category: 'mosaicos', name: 'Mosaico Tira', price: 200, image: '/products/mosaicos/panoramico-3-2.png', pieces: 3, grid: '1x3', gridSize: 3, originalImage: '/products/_originals/mosaicos/panoramico-3-2.png', isPredesigned: false, seamData: { vertical: [], horizontal: [0.337251, 0.662238], widthPercent: 0.004854 } },
  // Studio / Ghibli
  { id: 'ghi-1', category: 'ghibli', name: 'El Viaje de Chihiro', price: 480, image: '/products/ghibli/chihiro.png', pieces: 6, grid: '2x3', gridSize: 6, originalImage: '/products/_originals/ghibli/chihiro.png', isPredesigned: true, seamData: { vertical: [0.5], horizontal: [0.33894, 0.66157], widthPercent: 0.009202 } },
  { id: 'ghi-2', category: 'ghibli', name: 'Mi Vecino Totoro', price: 480, image: '/products/ghibli/totoro.png', pieces: 6, grid: '2x3', gridSize: 6, originalImage: '/products/_originals/ghibli/totoro.png', isPredesigned: true, seamData: { vertical: [0.502259], horizontal: [0.33894, 0.66157], widthPercent: 0.007696 } },
  { id: 'ghi-3', category: 'ghibli', name: 'Princesa Mononoke', price: 480, image: '/products/ghibli/mononoke.png', pieces: 6, grid: '2x3', gridSize: 6, originalImage: '/products/_originals/ghibli/mononoke.png', isPredesigned: true, seamData: { vertical: [0.500753], horizontal: [0.33894, 0.66157], widthPercent: 0.009623 } },
  { id: 'ghi-4', category: 'ghibli', name: 'El Castillo Vagabundo', price: 480, image: '/products/ghibli/howl.png', pieces: 6, grid: '2x3', gridSize: 6, originalImage: '/products/_originals/ghibli/howl.png', isPredesigned: true, seamData: { vertical: [0.502259], horizontal: [0.33894, 0.66157], widthPercent: 0.007526 } },
  { id: 'ghi-5', category: 'ghibli', name: 'El Viaje de Chihiro II', price: 480, image: '/products/ghibli/chihiro-2.png', pieces: 6, grid: '2x3', gridSize: 6, originalImage: '/products/_originals/ghibli/chihiro-2.png', isPredesigned: true, seamData: { vertical: [0.501506], horizontal: [0.33843, 0.66157], widthPercent: 0.008279 } },
  { id: 'ghi-6', category: 'ghibli', name: 'Kiki Entregas a Domicilio', price: 480, image: '/products/ghibli/kiki.png', pieces: 6, grid: '2x3', gridSize: 6, originalImage: '/products/_originals/ghibli/kiki.png', isPredesigned: true, seamData: { vertical: [0.500753], horizontal: [0.33894, 0.66157], widthPercent: 0.009453 } },
  { id: 'ghi-7', category: 'ghibli', name: 'Ponyo', price: 480, image: '/products/ghibli/ponyo.png', pieces: 6, grid: '2x3', gridSize: 6, originalImage: '/products/_originals/ghibli/ponyo.png', isPredesigned: true, seamData: { vertical: [0.500753], horizontal: [0.33894, 0.66157], widthPercent: 0.009453 } },
  { id: 'ghi-8', category: 'ghibli', name: 'El Nino y la Garza', price: 480, image: '/products/ghibli/garza.png', pieces: 6, grid: '2x3', gridSize: 6, originalImage: '/products/_originals/ghibli/garza.png', isPredesigned: true, seamData: { vertical: [0.500753], horizontal: [0.33894, 0.66157], widthPercent: 0.009453 } },
  // Arte (4x3 visual grid, 9 pieces: 8 art tiles + 1 info tile at row 3 col 4)
  { id: 'art-1', category: 'arte', name: 'La Noche Estrellada', price: 480, image: '/products/arte/noche-estrellada.png', pieces: 9, grid: '4x3', gridSize: 9, originalImage: '/products/_originals/arte/noche-estrellada.png', isPredesigned: true, seamData: { vertical: [0.255015, 0.498843, 0.743441], horizontal: [0.338619, 0.682864], widthPercent: 0.014036 } },
  { id: 'art-2', category: 'arte', name: 'La Mona Lisa', price: 480, image: '/products/arte/mona-lisa.png', pieces: 9, grid: '4x3', gridSize: 9, originalImage: '/products/_originals/arte/mona-lisa.png', isPredesigned: true, seamData: { vertical: [0.255015, 0.498843, 0.743441], horizontal: [0.338619, 0.641432], widthPercent: 0.010506 } },
  { id: 'art-3', category: 'arte', name: 'El Beso — Klimt', price: 480, image: '/products/arte/el-beso.png', pieces: 9, grid: '4x3', gridSize: 9, originalImage: '/products/_originals/arte/el-beso.png', isPredesigned: true, seamData: { vertical: [0.253858, 0.498071, 0.743056], horizontal: [0.332992, 0.652174], widthPercent: 0.00577 } },
  { id: 'art-4', category: 'arte', name: 'La Gran Ola', price: 480, image: '/products/arte/gran-ola.png', pieces: 9, grid: '4x3', gridSize: 9, originalImage: '/products/_originals/arte/gran-ola.png', isPredesigned: true, seamData: { vertical: [0.253858, 0.498071, 0.743056], horizontal: [0.334015, 0.652174], widthPercent: 0.00536 } },
  { id: 'art-5', category: 'arte', name: 'La Joven de la Perla', price: 480, image: '/products/arte/joven-perla.png', pieces: 9, grid: '4x3', gridSize: 9, originalImage: '/products/_originals/arte/joven-perla.png', isPredesigned: true, seamData: { vertical: [0.255015, 0.498843, 0.743056], horizontal: [0.338619, 0.682864], widthPercent: 0.014036 } },
  { id: 'art-6', category: 'arte', name: 'Las Dos Fridas', price: 480, image: '/products/arte/dos-fridas.png', pieces: 9, grid: '4x3', gridSize: 9, originalImage: '/products/_originals/arte/dos-fridas.png', isPredesigned: true, seamData: { vertical: [0.253858, 0.498071, 0.743056], horizontal: [0.335038, 0.653197], widthPercent: 0.004619 } },
  { id: 'art-7', category: 'arte', name: 'Nenufares — Monet', price: 480, image: '/products/arte/nenufares.png', pieces: 9, grid: '4x3', gridSize: 9, originalImage: '/products/_originals/arte/nenufares.png', isPredesigned: true, seamData: { vertical: [0.253858, 0.498071, 0.743441], horizontal: [0.335038, 0.641432], widthPercent: 0.009325 } },
  { id: 'art-8', category: 'arte', name: 'El Nacimiento de Venus', price: 480, image: '/products/arte/venus.png', pieces: 9, grid: '4x3', gridSize: 9, originalImage: '/products/_originals/arte/venus.png', isPredesigned: true, seamData: { vertical: [0.255015, 0.498071, 0.743441], horizontal: [0.335038, 0.682864], widthPercent: 0.013164 } },
  // Save the Date
  { id: 'std-1', category: 'save-the-date', name: 'Boda Elegante', price: 480, image: '/products/save-the-date/boda-9.png', pieces: 9, grid: '3x3', gridSize: 9, originalImage: '/products/_originals/save-the-date/boda-9.png', isPredesigned: true, seamData: { vertical: [0.338265, 0.661224], horizontal: [0.339295, 0.66326], widthPercent: 0.006509 } },
  { id: 'std-2', category: 'save-the-date', name: 'Compromiso', price: 360, image: '/products/save-the-date/compromiso-6.png', pieces: 6, grid: '2x3', gridSize: 6, originalImage: '/products/_originals/save-the-date/compromiso-6.png', isPredesigned: true, seamData: { vertical: [0.498871], horizontal: [0.333674, 0.656106], widthPercent: 0.007249 } },
  { id: 'std-3', category: 'save-the-date', name: 'Baby Shower', price: 200, image: '/products/save-the-date/baby-3.png', pieces: 3, grid: '1x3', gridSize: 3, originalImage: '/products/_originals/save-the-date/baby-3.png', isPredesigned: true, seamData: { vertical: [], horizontal: [0.337251, 0.659683], widthPercent: 0.002555 } },
  // Tonos
  { id: 'ton-1', category: 'tonos', name: 'Ramo de Rosas', price: 480, image: '/products/tonos/rosas-9.png', pieces: 9, grid: '3x3', gridSize: 9, originalImage: '/products/_originals/tonos/rosas-9.png', isPredesigned: true, seamData: { vertical: [0.333503, 0.655788], horizontal: [0.345262, 0.667339], widthPercent: 0.011781 } },
  { id: 'ton-2', category: 'tonos', name: 'Girasoles', price: 200, image: '/products/tonos/girasoles-3.png', pieces: 3, grid: '1x3', gridSize: 3, originalImage: '/products/_originals/tonos/girasoles-3.png', isPredesigned: true, seamData: { vertical: [], horizontal: [0.345262, 0.667339], widthPercent: 0.012853 } },
  // Spotify
  { id: 'spo-1', category: 'spotify', name: 'Album Cover Custom', price: 480, image: '/products/spotify/album-1.png', pieces: 6, grid: '2x3', gridSize: 6, originalImage: '/products/_originals/spotify/album-1.png', isPredesigned: true, seamData: { vertical: [0.499624], horizontal: [0.334694, 0.664286], widthPercent: 0.007414 } },
  { id: 'spo-2', category: 'spotify', name: 'Personalizado', price: 480, image: '/products/spotify/personalizado.png', pieces: 6, grid: '2x3', gridSize: 6, originalImage: '/products/_originals/spotify/personalizado.png', isPredesigned: true, seamData: { vertical: [0.501881], horizontal: [0.335204, 0.663265], widthPercent: 0.004468 } },
  // Polaroid
  { id: 'pol-1', category: 'polaroid', name: 'Tu Foto Polaroid', price: 480, image: '/products/polaroid/clasico.png', pieces: 4, grid: '2x2', gridSize: 4, originalImage: '/products/_originals/polaroid/clasico.png', isPredesigned: true, seamData: { vertical: [0.498871], horizontal: [0.501508], widthPercent: 0.010168 } },
  { id: 'pol-2', category: 'polaroid', name: 'Polaroid Vintage', price: 480, image: '/products/polaroid/vintage.png', pieces: 4, grid: '2x2', gridSize: 4, originalImage: '/products/_originals/polaroid/vintage.png', isPredesigned: true, seamData: { vertical: [0.501881], horizontal: [0.496229], widthPercent: 0.003387 } },
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
  ghibli: 'ghibli',
  arte: 'arte',
  'save-the-date': 'saveTheDate',
  tonos: 'tonos',
  spotify: 'spotify',
  polaroid: 'polaroid',
};

export const CATEGORY_ACCENT: Record<CategoryType, string> = {
  mosaicos: 'bg-terracotta',
  ghibli: 'bg-charcoal',
  arte: 'bg-gold',
  'save-the-date': 'bg-terracotta-light',
  tonos: 'bg-terracotta',
  spotify: 'bg-gold-dark',
  polaroid: 'bg-warm-gray',
};

export const CATALOG_CATEGORIES: CatalogCategory[] = [
  { type: 'mosaicos', i18nKey: 'mosaicos', accentColor: 'bg-terracotta', order: 1, showPersonalizeCard: true },
  { type: 'ghibli', i18nKey: 'ghibli', accentColor: 'bg-charcoal', order: 2, showPersonalizeCard: true },
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

// ─── Async helpers (merge static + dynamic products) ────────────────────────

export async function getAllProducts(): Promise<CatalogProduct[]> {
  try {
    const { getDynamicProducts } = await import('@/lib/admin/product-store');
    const dynamic = await getDynamicProducts();
    return [...PRODUCTS, ...dynamic];
  } catch {
    // R2 unavailable (e.g., during build) — return static only
    return [...PRODUCTS];
  }
}

export async function getAllProductsByCategory(): Promise<Map<CategoryType, CatalogProduct[]>> {
  const all = await getAllProducts();
  const map = new Map<CategoryType, CatalogProduct[]>();
  for (const cat of CATALOG_CATEGORIES) {
    map.set(cat.type, []);
  }
  for (const product of all) {
    const list = map.get(product.category);
    if (list) list.push(product);
  }
  return map;
}

export async function getProductByIdAsync(id: string): Promise<CatalogProduct | undefined> {
  // Check static first (fast path)
  const staticProduct = PRODUCTS.find((p) => p.id === id);
  if (staticProduct) return staticProduct;
  // Check dynamic
  try {
    const { getDynamicProducts } = await import('@/lib/admin/product-store');
    const dynamic = await getDynamicProducts();
    return dynamic.find((p) => p.id === id);
  } catch {
    return undefined;
  }
}
