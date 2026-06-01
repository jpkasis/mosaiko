import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getCart } from '@/lib/shopify/queries/cart';
import { CART_COOKIE, STATE_ATTR_KEY } from '@/lib/shopify/cart-cookie';
import type { CartItem } from '@/lib/cart-store';

// ─── GET /api/cart/load ─────────────────────────────────────────────────────
//
// Returns `{ items, cartStatus }`. `cartStatus === 'gone'` means the Shopify
// cart this cookie referenced was converted to an order OR expired (both
// surface as `cart(id:) === null` in Storefront API). The client uses
// `cartStatus` to decide whether to clear local Zustand state:
//   - 'gone'   → always clear local cache (the cart is over)
//   - 'active' → if server has items, server wins; if server is empty, keep
//                local UI cache (anonymous-session start, or cart not yet
//                synced to Shopify)
//
// "No cookie" is `active`, not `gone`, because we don't have a Shopify cart
// identity to disprove.

type CartLoadResponse = {
  items: CartItem[];
  cartStatus: 'active' | 'gone';
};

function activeEmpty(): CartLoadResponse {
  return { items: [], cartStatus: 'active' };
}

export async function GET() {
  const jar = await cookies();
  const cookie = jar.get(CART_COOKIE);

  if (!cookie?.value) {
    return NextResponse.json(activeEmpty());
  }

  // Shopify config gate: silently degrade to active-empty if creds missing
  // (dev with placeholder env, etc.). The cookie stays — once creds are
  // populated, the next load will hit Shopify properly.
  if (
    !process.env.NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN ||
    !process.env.NEXT_PUBLIC_SHOPIFY_STOREFRONT_TOKEN
  ) {
    return NextResponse.json(activeEmpty());
  }

  let cart = null;
  try {
    cart = await getCart(cookie.value);
  } catch (error) {
    // Network/parse error talking to Shopify. Treat as transient — don't
    // delete the cookie, don't signal "gone". Active-empty is the safe
    // degradation: the local UI cache is preserved.
    console.warn('[api/cart/load] getCart failed:', error);
    return NextResponse.json(activeEmpty());
  }

  if (!cart) {
    // Shopify says this cart is gone (converted to an order, or expired
    // past the ~30-day window). Clear the cookie so we don't keep asking,
    // and tell the client to clear its local cache too.
    jar.delete(CART_COOKIE);
    return NextResponse.json({
      items: [] satisfies CartItem[],
      cartStatus: 'gone',
    } satisfies CartLoadResponse);
  }

  const stateAttr = cart.attributes.find((a) => a.key === STATE_ATTR_KEY);
  if (!stateAttr?.value) {
    return NextResponse.json(activeEmpty());
  }

  try {
    const parsed = JSON.parse(stateAttr.value);
    if (!Array.isArray(parsed)) {
      return NextResponse.json(activeEmpty());
    }
    return NextResponse.json({
      items: parsed as CartItem[],
      cartStatus: 'active',
    } satisfies CartLoadResponse);
  } catch (error) {
    console.warn('[api/cart/load] parse mosaiko_state failed:', error);
    return NextResponse.json(activeEmpty());
  }
}
