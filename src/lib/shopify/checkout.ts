import { createCart, addToCart } from './mutations/cart';
import { getVariantId, isVariantMapConfigured } from './variant-map';
import { toPrintCustomization } from './customization-serializer';
import type { CartLineInput } from './types';
import type { CartItem } from '../cart-store';

// ─── Checkout orchestration ─────────────────────────────────────────────────

export interface CheckoutResult {
  checkoutUrl: string;
  cartId: string;
}

export interface CheckoutError {
  code: 'SHOPIFY_NOT_CONFIGURED' | 'VARIANT_NOT_FOUND' | 'CART_CREATION_FAILED' | 'EMPTY_CART';
  message: string;
}

/**
 * Translates local cart items into Shopify `CartLineInput[]`. Each line gets
 * the attributes consumed by the order webhook:
 * - _preview_image_url: visible in Shopify order details (and admin UI)
 * - _grid_type: e.g. "3x3"
 * - category: customization category (kept unprefixed — visible to customer)
 * - _photo_url(s): R2 URL(s) (underscore = hidden from customer receipt)
 * - _customization: full customization JSON
 * - _crop_area(s): crop area JSON
 * - _composite_key / _composite_url / _composite_pipeline_version:
 *     pre-rendered cart-composite the webhook can split into tiles
 *     (Phase 3.1) instead of re-running the Sharp processor. Version
 *     guards against pipeline-output changes (Phase 4 font fidelity).
 *
 * Returns a CheckoutError if Shopify isn't configured or a variant is missing.
 */
export function buildCartLines(
  items: CartItem[],
): CartLineInput[] | CheckoutError {
  const lines: CartLineInput[] = [];

  for (const item of items) {
    const variantId = getVariantId(item.gridSize);

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

      if (item.customizations.categoryType === 'tonos') {
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

  const linesOrError = buildCartLines(items);
  if (!Array.isArray(linesOrError)) return linesOrError;

  // Create Shopify cart and add lines
  try {
    const cart = await createCart();
    const updatedCart = await addToCart(cart.id, linesOrError);
    return {
      checkoutUrl: updatedCart.checkoutUrl,
      cartId: updatedCart.id,
    };
  } catch (error) {
    console.error('[checkout] Failed to create Shopify cart:', error);
    return {
      code: 'CART_CREATION_FAILED',
      message: 'Error al crear el carrito. Intenta de nuevo.',
    };
  }
}
