/**
 * Cart-cookie constants shared between `/api/cart/save`, `/api/cart/load`, and
 * any future cart endpoint that needs to read or set the Shopify cart ID.
 *
 * Shopify auto-deletes converted carts and expires abandoned carts after ~30
 * days (https://shopify.dev/docs/storefronts/headless/building-with-the-storefront-api/cart),
 * so `maxAge` matches that window. A `cart(id:)` query returning `null` is the
 * canonical "this cart is gone" signal — covers converted AND expired
 * identically. Mosaiko treats both the same way: clear the cookie + clear the
 * client UI cache.
 *
 * `mosaiko_state` attribute lives ON the Shopify cart object (key/value pair
 * in `attributes`) and stores the full Zustand snapshot so /api/cart/load can
 * rehydrate without reverse-engineering line attributes.
 */
export const CART_COOKIE = 'mosaiko_cart_id';

export const CART_COOKIE_MAX_AGE_S = 60 * 60 * 24 * 30; // 30 days

export const CART_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/',
  maxAge: CART_COOKIE_MAX_AGE_S,
};

export const STATE_ATTR_KEY = 'mosaiko_state';
