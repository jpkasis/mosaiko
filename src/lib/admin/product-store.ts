import { getJsonObject, putJsonObject, deleteFile, uploadBuffer, copyObject, getSignedUrl } from '@/lib/storage';
import type { CatalogProduct, SeamData } from '@/lib/catalog-data';
import type { CategoryType } from '@/lib/customization-types';
import type { GridSize } from '@/lib/grid-config';
import crypto from 'node:crypto';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface DynamicProduct extends CatalogProduct {
  isDynamic: true;
  displayImageKey: string;   // R2 key for composite display image
  originalImageKey: string;  // R2 key for seamless original
  createdAt: string;         // ISO date
}

interface DynamicProductsData {
  products: DynamicProduct[];
  version: number;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const CATALOG_JSON_KEY = 'catalog/products.json';
const CATALOG_IMAGES_PREFIX = 'catalog/images/';
const CACHE_TTL_MS = 60_000;

// ─── In-memory cache ────────────────────────────────────────────────────────

let cachedProducts: DynamicProduct[] | null = null;
let cacheTimestamp = 0;

function invalidateCache() {
  cachedProducts = null;
  cacheTimestamp = 0;
}

// ─── Read ───────────────────────────────────────────────────────────────────

export async function getDynamicProducts(): Promise<DynamicProduct[]> {
  if (cachedProducts && Date.now() - cacheTimestamp < CACHE_TTL_MS) {
    return cachedProducts;
  }

  const data = await getJsonObject<DynamicProductsData>('uploads', CATALOG_JSON_KEY);
  cachedProducts = data?.products ?? [];
  cacheTimestamp = Date.now();
  return cachedProducts;
}

// ─── Write ──────────────────────────────────────────────────────────────────

async function saveDynamicProducts(products: DynamicProduct[]): Promise<void> {
  const data: DynamicProductsData = { products, version: 1 };
  await putJsonObject('uploads', CATALOG_JSON_KEY, data);
  invalidateCache();
}

// ─── CRUD ───────────────────────────────────────────────────────────────────

export async function addProduct(input: {
  name: string;
  category: CategoryType;
  price: number;
  gridSize: GridSize;
  grid: string;
  pieces: number;
  tempImageKey: string;
  seamData: SeamData;
  originalBuffer: Buffer;
  contentType: string;
}): Promise<DynamicProduct> {
  const id = `dyn-${crypto.randomUUID().slice(0, 8)}`;
  const ext = input.contentType === 'image/png' ? 'png'
    : input.contentType === 'image/webp' ? 'webp' : 'jpg';

  // Move temp image to permanent key. Shopify Files has no native copy
  // — copyObject downloads + re-uploads. We then resolve the display URL
  // by filename lookup; with the legacy R2 backend this used the
  // synchronous `getPublicUrl(key)` mapping, which Shopify Files does
  // not expose.
  const displayKey = `${CATALOG_IMAGES_PREFIX}${id}-display.${ext}`;
  await copyObject('uploads', input.tempImageKey, displayKey);
  await deleteFile('uploads', input.tempImageKey);
  const displayUrl = await getSignedUrl(displayKey);

  // Upload clean original for print pipeline
  const originalKey = `${CATALOG_IMAGES_PREFIX}${id}-original.png`;
  const originalUpload = await uploadBuffer(
    'uploads',
    originalKey,
    input.originalBuffer,
    'image/png',
  );

  const product: DynamicProduct = {
    id,
    category: input.category,
    name: input.name,
    price: input.price,
    image: displayUrl,
    pieces: input.pieces,
    grid: input.grid,
    gridSize: input.gridSize,
    originalImage: originalUpload.publicUrl,
    seamData: input.seamData,
    isDynamic: true,
    displayImageKey: displayKey,
    originalImageKey: originalKey,
    createdAt: new Date().toISOString(),
  };

  const products = await getDynamicProducts();
  products.push(product);
  await saveDynamicProducts(products);

  return product;
}

export async function updateProduct(
  id: string,
  updates: Partial<Pick<CatalogProduct, 'name' | 'category' | 'price'>>,
): Promise<DynamicProduct | null> {
  const products = await getDynamicProducts();
  const idx = products.findIndex((p) => p.id === id);
  if (idx === -1) return null;

  if (updates.name !== undefined) products[idx].name = updates.name;
  if (updates.category !== undefined) products[idx].category = updates.category;
  if (updates.price !== undefined) products[idx].price = updates.price;

  await saveDynamicProducts(products);
  return products[idx];
}

export async function deleteProduct(id: string): Promise<boolean> {
  const products = await getDynamicProducts();
  const idx = products.findIndex((p) => p.id === id);
  if (idx === -1) return false;

  const product = products[idx];
  products.splice(idx, 1);
  await saveDynamicProducts(products);

  // Clean up R2 images (fire and forget)
  await Promise.allSettled([
    deleteFile('uploads', product.displayImageKey),
    deleteFile('uploads', product.originalImageKey),
  ]);

  return true;
}
