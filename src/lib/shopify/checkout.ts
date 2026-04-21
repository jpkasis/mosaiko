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
 * Creates a Shopify cart from local cart items and returns the checkout URL.
 *
 * Each custom item gets attributes for the webhook to process:
 * - preview_image_url: visible in Shopify order details
 * - grid_type: e.g. "3x3"
 * - category: customization category
 * - _photo_url: R2 URL (underscore = hidden from customer receipt)
 * - _customization: full customization JSON
 * - _crop_area: crop area JSON
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

  // Build cart lines
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

    const attributes: { key: string; value: string }[] = [
      { key: 'preview_image_url', value: item.previewUrl || '' },
      { key: 'grid_type', value: `${item.gridLayout.rows}x${item.gridLayout.cols}` },
    ];

    if (item.customizations) {
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
    }

    lines.push({
      merchandiseId: variantId,
      quantity: item.quantity,
      attributes,
    });
  }

  // Create Shopify cart and add lines
  try {
    const cart = await createCart();
    const updatedCart = await addToCart(cart.id, lines);
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
