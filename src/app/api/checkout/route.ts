import { NextRequest, NextResponse } from 'next/server';
import {
  createCheckout,
  assertCartTotalMatchesDisplay,
  assertItemsMeetMinimum,
} from '@/lib/shopify/checkout';
import type { CartItem } from '@/lib/cart-store';

// ─── POST /api/checkout ─────────────────────────────────────────────────────
//
// Receives local cart items, creates a Shopify cart with custom attributes,
// and returns the hosted checkout URL.

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const items: CartItem[] = body.items;
    const displayedTotal: unknown = body.displayedTotal;

    if (!Array.isArray(items) || items.length === 0) {
      return NextResponse.json(
        { error: 'El carrito está vacío.' },
        { status: 400 },
      );
    }

    // PR-B (Codex 3rd audit): /api/checkout always returns a redirect URL, so a
    // verified displayed total is REQUIRED here — we never send a customer to
    // pay at a price we couldn't confirm they saw. The current client always
    // sends it; a stale pre-deploy client is told to reload.
    if (typeof displayedTotal !== 'number' || !Number.isFinite(displayedTotal)) {
      return NextResponse.json(
        {
          error: 'No pudimos confirmar el total. Recarga la página e intenta de nuevo.',
          code: 'DISPLAYED_TOTAL_REQUIRED',
        },
        { status: 400 },
      );
    }

    // PR-C (Codex full-audit BLOCKER fix): enforce the minimum order BEFORE
    // creating any Shopify cart, so a below-minimum cart never exists.
    const minBlock = await assertItemsMeetMinimum(items);
    if (minBlock) {
      return NextResponse.json(
        {
          error: minBlock.message,
          code: minBlock.code,
          minimum: minBlock.minimum,
          total: minBlock.total,
        },
        { status: minBlock.status },
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
        PRICING_UNAVAILABLE: 503,
      };
      return NextResponse.json(
        { error: result.message, code: result.code },
        { status: statusMap[result.code] || 500 },
      );
    }

    // Gate the redirect on the cart's REAL Shopify subtotal (atomic with the
    // charge): drift → 409, an untrustworthy/non-MXN total → 502. Never pay at
    // a price the customer didn't see.
    const gate = assertCartTotalMatchesDisplay(result.subtotal, displayedTotal);
    if (gate) {
      return NextResponse.json(
        { error: gate.message, code: gate.code, total: gate.total },
        { status: gate.status },
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
