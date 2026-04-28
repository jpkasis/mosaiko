import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getCart } from '@/lib/shopify/queries/cart';
import type { CartItem } from '@/lib/cart-store';

const CART_COOKIE = 'mosaiko_cart_id';
const STATE_ATTR_KEY = 'mosaiko_state';

// ─── GET /api/cart/load ─────────────────────────────────────────────────────

export async function GET() {
  const jar = await cookies();
  const cookie = jar.get(CART_COOKIE);

  // No cookie → nothing to restore. Respond with empty items so the client
  // path stays simple.
  if (!cookie?.value) {
    return NextResponse.json({ items: [] satisfies CartItem[] });
  }

  // Shopify config gate: silently empty if creds missing (dev, etc.).
  if (
    !process.env.NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN ||
    !process.env.NEXT_PUBLIC_SHOPIFY_STOREFRONT_TOKEN
  ) {
    return NextResponse.json({ items: [] satisfies CartItem[] });
  }

  let cart = null;
  try {
    cart = await getCart(cookie.value);
  } catch (error) {
    console.warn('[api/cart/load] getCart failed:', error);
    return NextResponse.json({ items: [] satisfies CartItem[] });
  }

  if (!cart) {
    // Expired/invalid cart id — clear the cookie so we don't keep asking.
    jar.delete(CART_COOKIE);
    return NextResponse.json({ items: [] satisfies CartItem[] });
  }

  const stateAttr = cart.attributes.find((a) => a.key === STATE_ATTR_KEY);
  if (!stateAttr?.value) {
    return NextResponse.json({ items: [] satisfies CartItem[] });
  }

  try {
    const parsed = JSON.parse(stateAttr.value);
    if (!Array.isArray(parsed)) {
      return NextResponse.json({ items: [] satisfies CartItem[] });
    }
    return NextResponse.json({ items: parsed as CartItem[] });
  } catch (error) {
    console.warn('[api/cart/load] parse mosaiko_state failed:', error);
    return NextResponse.json({ items: [] satisfies CartItem[] });
  }
}
