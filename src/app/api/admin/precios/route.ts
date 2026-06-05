/**
 * PR-B — admin price editor API. Reads/writes the per-(category, size)
 * prices that live as Shopify variant prices on the v2 pricing product
 * (the single source of truth). Behind `verifySession()`.
 *
 *   GET  → the current price matrix as flat editable rows.
 *   PUT  → write edited prices to Shopify via `productVariantsBulkUpdate`,
 *          then `revalidateTag` so the storefront reflects them at once.
 *
 * Keeps the client UI free of Shopify GIDs/jargon — the route resolves
 * variant IDs + the product ID from the live matrix.
 */
import { NextRequest, NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import { verifySession } from '@/lib/admin/auth';
import { getPriceMatrix, PRICE_MATRIX_TAG } from '@/lib/shopify/prices';
import {
  getPricingProductId,
  bulkUpdateVariantPrices,
  type VariantPriceUpdate,
} from '@/lib/shopify/mutations/product-variants';
import { ShopifyUserErrorsError } from '@/lib/shopify/mutations/metaobjects';
import { PRICING_COMBOS } from '@/lib/shopify/pricing-options';
import {
  CATEGORY_REGISTRY,
  type CategoryType,
} from '@/lib/customization-types';
import { type GridSize, singleTilePriceFrom } from '@/lib/grid-config';

function unauthorized(): NextResponse {
  return NextResponse.json(
    { error: { code: 'UNAUTHORIZED', message: 'No autorizado.' } },
    { status: 401 },
  );
}

/** PR-C: the single-tile (mosaicos, 1) price is DERIVED from the 3-piece —
 *  not editable on its own. */
function isDerivedCombo(category: CategoryType, gridSize: GridSize): boolean {
  return category === 'mosaicos' && gridSize === 1;
}

export interface PriceRow {
  category: CategoryType;
  categoryLabel: string;
  gridSize: GridSize;
  price: number;
  /** false when the v2 product isn't live yet (seed values, read-only), or
   *  when the row is a derived (auto-calculated) price. */
  editable: boolean;
  /** PR-C: true for the single-tile row (auto = ⅓ of the 3-piece price). */
  derived?: boolean;
  derivedLabel?: string;
}

// ─── GET: current prices ────────────────────────────────────────────────────

export async function GET(): Promise<NextResponse> {
  if (!(await verifySession())) return unauthorized();

  const matrix = await getPriceMatrix();
  const rows: PriceRow[] = PRICING_COMBOS.map(({ category, gridSize }) => {
    const cell = matrix[category]?.[gridSize];
    const derived = isDerivedCombo(category, gridSize);
    return {
      category,
      categoryLabel: CATEGORY_REGISTRY[category].label,
      gridSize,
      price: cell?.price ?? 0,
      editable: Boolean(cell?.variantId) && !derived,
      ...(derived
        ? { derived: true, derivedLabel: '= ⅓ del precio de 3 piezas' }
        : {}),
    };
  });

  // "migrated" = the v2 product is live (at least one cell has a variant id).
  const migrated = rows.some((r) => Boolean(matrix[r.category]?.[r.gridSize]?.variantId));
  return NextResponse.json({ migrated, rows });
}

// ─── PUT: save edited prices ────────────────────────────────────────────────

interface PriceEdit {
  category: CategoryType;
  gridSize: GridSize;
  price: number;
}

const VALID_COMBO = new Set(
  PRICING_COMBOS.map(({ category, gridSize }) => `${category}:${gridSize}`),
);

function validateEdits(body: unknown): PriceEdit[] | string {
  if (!body || typeof body !== 'object' || !Array.isArray((body as { updates?: unknown }).updates)) {
    return 'Cuerpo inválido: se esperaba { updates: [...] }.';
  }
  const updates = (body as { updates: unknown[] }).updates;
  const edits: PriceEdit[] = [];
  for (const u of updates) {
    if (!u || typeof u !== 'object') return 'Entrada de precio inválida.';
    const { category, gridSize, price } = u as Record<string, unknown>;
    if (typeof category !== 'string' || typeof gridSize !== 'number') {
      return 'Categoría o tamaño inválido.';
    }
    if (!VALID_COMBO.has(`${category}:${gridSize}`)) {
      return `Combinación no permitida: ${category} ${gridSize}.`;
    }
    if (typeof price !== 'number' || !Number.isInteger(price) || price < 1 || price > 100000) {
      return `Precio inválido para ${category} ${gridSize}: usa pesos enteros (1–100000).`;
    }
    edits.push({ category: category as CategoryType, gridSize: gridSize as GridSize, price });
  }
  return edits;
}

export async function PUT(request: NextRequest): Promise<NextResponse> {
  if (!(await verifySession())) return unauthorized();

  const edits = validateEdits(await request.json().catch(() => null));
  if (typeof edits === 'string') {
    return NextResponse.json({ error: { code: 'INVALID_BODY', message: edits } }, { status: 400 });
  }

  // PR-C: the single-tile price is derived (⅓ of the 3-piece), never edited
  // directly. Reject rather than silently ignore so the UI bug surfaces.
  if (edits.some((e) => isDerivedCombo(e.category, e.gridSize))) {
    return NextResponse.json(
      {
        error: {
          code: 'DERIVED_PRICE_READ_ONLY',
          message: 'El precio de 1 pieza se calcula automáticamente (⅓ del de 3 piezas).',
        },
      },
      { status: 400 },
    );
  }

  if (edits.length === 0) {
    return NextResponse.json({ ok: true, updated: 0 });
  }

  const [matrix, productId] = await Promise.all([getPriceMatrix(), getPricingProductId()]);
  if (!productId) {
    return NextResponse.json(
      {
        error: {
          code: 'NOT_MIGRATED',
          message: 'Los precios aún no se han migrado a Shopify. Ejecuta la migración primero.',
        },
      },
      { status: 409 },
    );
  }

  // Canonicalize edits: last write wins per (category, size). A duplicate
  // 3-piece edit would otherwise let `variantUpdates` apply the LAST value
  // while the derived single tile is computed from the FIRST — desync (Codex
  // PR-C audit). Deriving below from this same map keeps them consistent.
  const dedup = new Map<string, PriceEdit>();
  for (const e of edits) dedup.set(`${e.category}:${e.gridSize}`, e);

  // Resolve each edit to its variant GID from the live matrix.
  const variantUpdates: VariantPriceUpdate[] = [];
  for (const e of dedup.values()) {
    const variantId = matrix[e.category]?.[e.gridSize]?.variantId;
    if (!variantId) {
      return NextResponse.json(
        {
          error: {
            code: 'VARIANT_NOT_FOUND',
            message: `No se encontró la variante de Shopify para ${e.category} ${e.gridSize}.`,
          },
        },
        { status: 409 },
      );
    }
    variantUpdates.push({ variantId, price: e.price });
  }

  // PR-C derive-on-save: keep the single-tile (mosaicos:1) price = ⌈3-piece/3⌉
  // on EVERY save — whether the 3-piece was edited this round or another
  // category was — so it always tracks the (editable) 3-piece price.
  const nextThree =
    dedup.get('mosaicos:3')?.price ?? matrix.mosaicos?.[3]?.price;
  if (nextThree != null) {
    const singleVariantId = matrix.mosaicos?.[1]?.variantId;
    if (!singleVariantId) {
      return NextResponse.json(
        {
          error: {
            code: 'VARIANT_NOT_FOUND',
            message: 'No se encontró la variante de Shopify para mosaicos 1 (1 pieza).',
          },
        },
        { status: 409 },
      );
    }
    const derivedPrice = singleTilePriceFrom(nextThree);
    // Skip a redundant write when it's already in sync.
    if (matrix.mosaicos?.[1]?.price !== derivedPrice) {
      variantUpdates.push({ variantId: singleVariantId, price: derivedPrice });
    }
  }

  try {
    await bulkUpdateVariantPrices(productId, variantUpdates);
  } catch (err) {
    const message =
      err instanceof ShopifyUserErrorsError
        ? err.message
        : 'Shopify rechazó la actualización de precios.';
    return NextResponse.json({ error: { code: 'SHOPIFY_REJECTED', message } }, { status: 502 });
  }

  revalidateTag(PRICE_MATRIX_TAG, { expire: 0 });
  return NextResponse.json({ ok: true, updated: variantUpdates.length });
}
