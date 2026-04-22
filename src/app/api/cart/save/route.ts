import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createCart } from '@/lib/shopify/mutations/cart';
import { buildCartLines } from '@/lib/shopify/checkout';
import type { CartItem } from '@/lib/cart-store';

// ─── Constants ──────────────────────────────────────────────────────────────

const CART_COOKIE = 'mosaiko_cart_id';
// Shopify anonymous carts live ~10 days after last modification — match it.
const CART_COOKIE_MAX_AGE_S = 10 * 24 * 60 * 60;
// Cart attributes in Shopify have a practical size budget. Keep the JSON
// blob comfortably small; line-item attributes still carry the full
// customization and feed the webhook regardless.
const STATE_ATTR_MAX_BYTES = 4_000;
const STATE_ATTR_KEY = 'mosaiko_state';

// ─── POST /api/cart/save ────────────────────────────────────────────────────

export async function POST(request: Request) {
  // Shopify config gate — silently unavailable if creds missing, so client can
  // degrade to local-only behaviour without surfacing a blocking error.
  if (
    !process.env.NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN ||
    !process.env.NEXT_PUBLIC_SHOPIFY_STOREFRONT_TOKEN
  ) {
    return NextResponse.json(
      { code: 'SHOPIFY_NOT_CONFIGURED', message: 'Shopify not configured.' },
      { status: 503 },
    );
  }

  let body: { items?: unknown };
  try {
    body = (await request.json()) as { items?: unknown };
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!Array.isArray(body.items)) {
    return NextResponse.json(
      { error: 'Missing required field: items[]' },
      { status: 400 },
    );
  }

  const items = body.items as CartItem[];

  // Empty cart: no-op. Don't create empty Shopify carts; let the old one age
  // out. Client treats a 204 as "nothing to restore yet".
  if (items.length === 0) {
    return new NextResponse(null, { status: 204 });
  }

  const linesOrError = buildCartLines(items);
  if (!Array.isArray(linesOrError)) {
    return NextResponse.json(linesOrError, { status: 503 });
  }

  // Serialize the full Zustand state snapshot so /api/cart/load can rehydrate
  // without reverse-mapping line attributes. Skip the attribute if oversized
  // (rare — well under cap for typical carts); line items still persist for
  // Shopify checkout + the webhook.
  const stateJson = JSON.stringify(items);
  const attributes =
    stateJson.length <= STATE_ATTR_MAX_BYTES
      ? [{ key: STATE_ATTR_KEY, value: stateJson }]
      : (console.warn(
          `[api/cart/save] mosaiko_state JSON exceeds ${STATE_ATTR_MAX_BYTES} bytes (${stateJson.length}); skipping attribute.`,
        ),
        []);

  try {
    const cart = await createCart({
      lines: linesOrError,
      attributes,
    });

    const jar = await cookies();
    jar.set({
      name: CART_COOKIE,
      value: cart.id,
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: CART_COOKIE_MAX_AGE_S,
    });

    return NextResponse.json({
      cartId: cart.id,
      checkoutUrl: cart.checkoutUrl,
    });
  } catch (error) {
    console.error('[api/cart/save] createCart failed:', error);
    return NextResponse.json(
      { code: 'CART_CREATION_FAILED', message: 'Failed to save cart' },
      { status: 502 },
    );
  }
}
