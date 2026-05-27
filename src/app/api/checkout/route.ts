import { NextRequest, NextResponse } from 'next/server';
import { createCheckout } from '@/lib/shopify/checkout';
import type { CartItem } from '@/lib/cart-store';

// ─── POST /api/checkout ─────────────────────────────────────────────────────
//
// Receives local cart items, creates a Shopify cart with custom attributes,
// and returns the hosted checkout URL.

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const items: CartItem[] = body.items;

    if (!Array.isArray(items) || items.length === 0) {
      return NextResponse.json(
        { error: 'El carrito está vacío.' },
        { status: 400 },
      );
    }

    const result = await createCheckout(items);

    // Check if result is an error
    if ('code' in result) {
      const statusMap: Record<string, number> = {
        EMPTY_CART: 400,
        SHOPIFY_NOT_CONFIGURED: 503,
        VARIANT_NOT_FOUND: 422,
        CART_CREATION_FAILED: 502,
        LAYOUT_EXAMPLE_NOT_PURCHASABLE: 400,
        INVALID_PREDESIGNED_LINE: 400,
      };
      return NextResponse.json(
        { error: result.message, code: result.code },
        { status: statusMap[result.code] || 500 },
      );
    }

    return NextResponse.json({
      checkoutUrl: result.checkoutUrl,
      cartId: result.cartId,
    });
  } catch (error) {
    console.error('[api/checkout] Unexpected error:', error);
    return NextResponse.json(
      { error: 'Error inesperado. Intenta de nuevo.' },
      { status: 500 },
    );
  }
}
