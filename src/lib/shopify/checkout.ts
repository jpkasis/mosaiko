import { createCart, addToCart } from './mutations/cart';
import { getVariantId, isVariantMapConfigured } from './variant-map';
import { getPricingForCheckout } from './prices';
import { toPrintCustomization } from './customization-serializer';
import { isPurchasableAsIs } from '../catalog-purchase-mode';
import { getProductById } from '../catalog-data';
import { CATEGORY_LAYOUTS } from '../category-layouts';
import { isMultiPhotoInput } from '../category-layouts/derive';
import type { CategoryType } from '../customization-types';
import type { CartLineInput, ShopifyMoney } from './types';
import type { CartItem } from '../cart-store';

// The store sells exclusively in Mexican Pesos (see CLAUDE.md / formatPrice).
// The consent gate requires the cart's currency to match this — a numeric
// total in any other currency must never pass (e.g. 480 USD ≠ 480 MXN).
const STORE_CURRENCY = 'MXN';

// ─── Checkout orchestration ─────────────────────────────────────────────────

export interface CheckoutResult {
  checkoutUrl: string;
  cartId: string;
  /**
   * The cart's Shopify-authoritative subtotal (amount + currency; sum of real
   * variant line prices, pre-tax/shipping) — i.e. exactly what the customer
   * will be charged. The route passes this to `assertCartTotalMatchesDisplay`
   * before handing back the checkout URL.
   */
  subtotal: ShopifyMoney;
}

export interface CheckoutError {
  code:
    | 'SHOPIFY_NOT_CONFIGURED'
    | 'VARIANT_NOT_FOUND'
    | 'CART_CREATION_FAILED'
    | 'EMPTY_CART'
    | 'LAYOUT_EXAMPLE_NOT_PURCHASABLE'
    | 'INVALID_PREDESIGNED_LINE'
    | 'PRICING_UNAVAILABLE'
    | 'PRICES_CHANGED';
  message: string;
}

export interface CheckoutGateBlock {
  code: 'PRICES_CHANGED' | 'CART_SUBTOTAL_UNAVAILABLE';
  message: string;
  /** HTTP status the route should respond with (409 drift, 502 untrustworthy). */
  status: number;
  /** The real charge total — present only for PRICES_CHANGED. */
  total?: number;
}

/**
 * PR-B (Codex 3rd/4th audit) — authoritative consent gate.
 *
 * The client sends the total it DISPLAYED to the customer; we compare it
 * against `cartSubtotal` — the money Shopify ACTUALLY put in the created cart
 * (`cost.subtotalAmount`, priced from the real variant prices). Because that
 * subtotal IS what the customer will be charged, the comparison is atomic with
 * the charge itself — there is no separate price map that could disagree with
 * the cart (the original version compared against a tolerant display map read
 * separately from the strict pricing used to pick variants, which could drift).
 *
 * FAILS CLOSED (Codex 4th audit): if the subtotal can't be parsed as a finite
 * number, or its currency isn't the store currency (MXN) — so a numeric match
 * across currencies can't slip through — it returns a blocking
 * CART_SUBTOTAL_UNAVAILABLE (502) rather than letting the checkout proceed.
 *
 * Returns:
 *  - PRICES_CHANGED (409) when the trustworthy MXN total differs from displayed.
 *  - CART_SUBTOTAL_UNAVAILABLE (502) when the total can't be trusted.
 *  - null when they match, or when `displayedTotal` is absent (the pagehide
 *    beacon only persists the cart and never redirects — no price to honor;
 *    interactive callers always send it).
 */
export function assertCartTotalMatchesDisplay(
  cartSubtotal: ShopifyMoney | undefined,
  displayedTotal: number | undefined,
): CheckoutGateBlock | null {
  // Beacon / nothing displayed to honor → nothing to gate.
  if (displayedTotal == null || !Number.isFinite(displayedTotal)) return null;

  const amount = cartSubtotal ? Number(cartSubtotal.amount) : NaN;
  // Fail CLOSED: never hand back a checkout URL when we can't establish a
  // trustworthy MXN charge total (missing/NaN amount, or a non-MXN currency).
  if (!Number.isFinite(amount) || cartSubtotal?.currencyCode !== STORE_CURRENCY) {
    return {
      code: 'CART_SUBTOTAL_UNAVAILABLE',
      message: 'No pudimos confirmar el total. Intenta de nuevo o contáctanos.',
      status: 502,
    };
  }

  if (Math.round(amount * 100) === Math.round(displayedTotal * 100)) return null;
  return {
    code: 'PRICES_CHANGED',
    message: 'Los precios se actualizaron. Revisa tu total y vuelve a continuar.',
    status: 409,
    total: amount,
  };
}

/**
 * Translates local cart items into Shopify `CartLineInput[]`. Each line gets
 * the attributes consumed by the order webhook:
 * - _preview_image_url: visible in Shopify order details (and admin UI)
 * - _grid_type: e.g. "3x3"
 * - category: customization category (kept unprefixed — visible to customer)
 * - _photo_url(s): Shopify Files URL(s) (underscore = hidden from customer receipt)
 * - _customization: full customization JSON
 * - _crop_area(s): crop area JSON
 * - _composite_key / _composite_url / _composite_pipeline_version:
 *     pre-rendered cart-composite the webhook can split into tiles
 *     (Phase 3.1) instead of re-running the Sharp processor. Version
 *     guards against pipeline-output changes (Phase 4 font fidelity).
 *
 * Returns a CheckoutError if Shopify isn't configured or a variant is missing.
 */
export async function buildCartLines(
  items: CartItem[],
): Promise<CartLineInput[] | CheckoutError> {
  const lines: CartLineInput[] = [];

  // PR-B: resolve pricing ONCE, STRICTLY (Codex audit). `migrated` says
  // whether the v2 product is live. A real Shopify read error fails the whole
  // checkout (`PRICING_UNAVAILABLE`) — we never guess/charge a fallback price.
  const pricing = await getPricingForCheckout().catch(() => null);
  if (!pricing) {
    return {
      code: 'PRICING_UNAVAILABLE',
      message:
        'No pudimos confirmar los precios en este momento. Inténtalo de nuevo en unos segundos.',
    };
  }

  for (const item of items) {
    // UAT-1a guard (round 2 — fail-CLOSED + spoof-resistant): for
    // every `predesigned` line, derive the truth from the catalog by
    // looking up `productId`. We never trust the client-supplied
    // `categorySlug` because a hand-crafted POST could pair
    // `categorySlug: "studio"` with a Polaroid productId. The
    // catalog is the only source of truth for category.
    //
    // Reject if:
    //   - productId is missing
    //   - productId doesn't match a known catalog product
    //   - the looked-up product's category is layout-example
    //     (Mosaicos/Tonos/STD/Spotify/Polaroid)
    //
    // Dynamic admin products are not in the sync `getProductById`
    // lookup yet — they'd reject here. That's fine until admin
    // product CRUD ships (deferred to post-launch per CLAUDE.md).
    // Category drives BOTH the (spoof-resistant) purchase-mode guard and the
    // PR-B per-category variant lookup. For predesigned lines it comes from
    // the trusted catalog (never the client); for custom lines from the
    // customization.
    let category: CategoryType | null = null;

    if (item.type === 'predesigned') {
      if (!item.productId) {
        return {
          code: 'INVALID_PREDESIGNED_LINE',
          message: 'Hubo un problema con tu carrito. Vacía el carrito y vuelve a personalizar tu pedido.',
        };
      }
      const trustedProduct = getProductById(item.productId);
      if (!trustedProduct) {
        return {
          code: 'INVALID_PREDESIGNED_LINE',
          message: 'Hubo un problema con tu carrito. Vacía el carrito y vuelve a personalizar tu pedido.',
        };
      }
      if (!isPurchasableAsIs(trustedProduct.category)) {
        return {
          code: 'LAYOUT_EXAMPLE_NOT_PURCHASABLE',
          message: `Los productos de la categoría ${trustedProduct.category} son ejemplos. Personaliza el tuyo con tu propia foto.`,
        };
      }
      category = trustedProduct.category as CategoryType;
    } else if (item.customizations) {
      category = item.customizations.categoryType;
    }

    // PR-B (Codex audit — fail closed): charge the per-(category, size) v2
    // variant when the product is live. The legacy size-only variant is used
    // ONLY when we positively confirmed the product isn't migrated yet. If the
    // product IS live but this combo is missing/unavailable, leave variantId
    // null → error below, rather than silently charging the legacy size price.
    const cell = category ? pricing.matrix[category]?.[item.gridSize] : undefined;
    let variantId: string | null = null;
    if (cell?.variantId && cell.availableForSale) {
      variantId = cell.variantId;
    } else if (!pricing.migrated) {
      variantId = getVariantId(item.gridSize);
    }

    if (!variantId) {
      if (!isVariantMapConfigured()) {
        return {
          code: 'SHOPIFY_NOT_CONFIGURED',
          message: 'Los productos de Shopify aún no están configurados. Contacta al administrador.',
        };
      }
      return {
        code: 'VARIANT_NOT_FOUND',
        message: `No se encontró variante para el tamaño ${item.gridSize} piezas.`,
      };
    }

    // `_`-prefix convention: keys starting with `_` are hidden from the
    // customer-facing receipt and survive the webhook's
    // `extractCustomizedLineItems` filter. Phase 3.4 reconciles
    // `_preview_image_url` and `_grid_type` into the same scheme so the
    // admin UI + email template still see them after the filter.
    //
    // BLOCKER fix (Codex Phase 3 audit): stamp these `_` display attrs
    // ONLY on customized lines. A `predesigned` line without
    // `customizations` would otherwise carry `_preview_image_url` and
    // pass the webhook's `_`-prefix filter, then immediately fail with
    // `missing_customization_attr` in `processLineItem`.
    const attributes: { key: string; value: string }[] = [];

    if (item.customizations) {
      attributes.push(
        { key: '_preview_image_url', value: item.previewUrl || '' },
        { key: '_grid_type', value: `${item.gridLayout.rows}x${item.gridLayout.cols}` },
      );
      attributes.push(
        { key: 'category', value: item.customizations.categoryType },
        { key: '_customization', value: JSON.stringify(toPrintCustomization(item)) },
      );

      // UAT-3 Phase 3 (Codex audit E9): multi-photo cart attrs are
      // derived from the layout contract, not a literal category list.
      // `isMultiPhotoInput` is the single source of truth across cart,
      // preview, generate-print, and webhook. STD-9/STD-6 single,
      // STD-3 multi; Tonos always multi.
      const isMultiPhotoCart = isMultiPhotoInput(
        CATEGORY_LAYOUTS[item.customizations.categoryType],
        item.gridSize,
      );

      if (isMultiPhotoCart) {
        const urls = item.customizations.photoStorageUrls ?? ['', '', ''];
        const crops = item.customizations.cropAreas;
        attributes.push(
          { key: '_photo_urls', value: JSON.stringify(urls) },
          // First URL also exposed under the legacy single-URL key for compatibility.
          { key: '_photo_url', value: urls[0] || '' },
        );
        if (crops) {
          attributes.push({ key: '_crop_areas', value: JSON.stringify(crops) });
        }
      } else {
        attributes.push({
          key: '_photo_url',
          value: item.customizations.photoStorageUrl || '',
        });
        if (item.customizations.cropArea) {
          attributes.push({
            key: '_crop_area',
            value: JSON.stringify(item.customizations.cropArea),
          });
        }
        // UAT-6 PR5: single-photo 90° rotation. Emit only when nonzero —
        // absence === 0 keeps pre-PR5 carts/orders printing unchanged. The
        // webhook re-validates via `whitelistImageRotation` (0/90/180/270).
        if (item.customizations.imageRotation) {
          attributes.push({
            key: '_image_rotation',
            value: String(item.customizations.imageRotation),
          });
        }
      }

      // Composite-reuse forwarding (Phase 3.1). Only include when the
      // cart actually has a stored composite (compositeKey is non-empty
      // and not the dev-fallback in-memory blob path). Webhook validates
      // strictly before bypassing `processPrintJob`; missing or invalid
      // → fall back to full pipeline.
      //
      // Codex Phase 3 audit MAJOR fix: forward the stored
      // `compositePipelineVersion` (stamped at composite-creation time
      // in `/api/cart-composite`), NOT the current `PIPELINE_VERSION`
      // const. A cart item created before a renderer deploy and checked
      // out after must carry the OLD version — the webhook will then
      // detect the mismatch and fall back to full pipeline. Stamping
      // the current const at checkout time would defeat the version
      // guard and bypass with stale pixels.
      if (
        item.customizations.compositeKey &&
        item.customizations.compositeUrl &&
        item.customizations.compositePipelineVersion &&
        // Reject the dev-mode blob fallback (compositeKey is null then).
        item.customizations.compositeKey.length > 0
      ) {
        attributes.push(
          { key: '_composite_key', value: item.customizations.compositeKey },
          { key: '_composite_url', value: item.customizations.compositeUrl },
          {
            key: '_composite_pipeline_version',
            value: item.customizations.compositePipelineVersion,
          },
        );
      }
    }

    lines.push({
      merchandiseId: variantId,
      quantity: item.quantity,
      attributes,
    });
  }

  return lines;
}

/**
 * Creates a Shopify cart from local cart items and returns the checkout URL.
 * Fallback path; the primary flow uses /api/cart/save which keeps a cart
 * synchronised in Shopify on every mutation.
 */
export async function createCheckout(
  items: CartItem[],
): Promise<CheckoutResult | CheckoutError> {
  if (items.length === 0) {
    return { code: 'EMPTY_CART', message: 'El carrito está vacío.' };
  }

  // Check Shopify config
  if (!process.env.NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN || !process.env.NEXT_PUBLIC_SHOPIFY_STOREFRONT_TOKEN) {
    return {
      code: 'SHOPIFY_NOT_CONFIGURED',
      message: 'La tienda de Shopify aún no está configurada. Contacta al administrador.',
    };
  }

  const linesOrError = await buildCartLines(items);
  if (!Array.isArray(linesOrError)) return linesOrError;

  // Create Shopify cart and add lines
  try {
    const cart = await createCart();
    const updatedCart = await addToCart(cart.id, linesOrError);
    return {
      checkoutUrl: updatedCart.checkoutUrl,
      cartId: updatedCart.id,
      // Shopify-authoritative charge total (amount + currency) — the route
      // gates the URL on this.
      subtotal: updatedCart.cost.subtotalAmount,
    };
  } catch (error) {
    console.error('[checkout] Failed to create Shopify cart:', error);
    return {
      code: 'CART_CREATION_FAILED',
      message: 'Error al crear el carrito. Intenta de nuevo.',
    };
  }
}
