import { shopifyFetch } from '../client';
import { reshapeCart } from '../reshape';
import { CART_FRAGMENT } from '../queries/cart';
import type {
  ShopifyCart,
  Cart,
  CartLineInput,
  CartLineUpdateInput,
  CartLineAttribute,
} from '../types';

// The store operates in the Mexican market (MXN). Carts are created
// server-side (Vercel), so we pin the buyer country explicitly rather than let
// Shopify infer it from the server IP — this keeps `cost.subtotalAmount` in
// MXN, which the checkout consent gate (`assertCartTotalMatchesDisplay`)
// requires.
const STORE_COUNTRY = 'MX';

// ─── Mutations ──────────────────────────────────────────────────────────────

const CREATE_CART_MUTATION = /* GraphQL */ `
  ${CART_FRAGMENT}
  mutation CreateCart($input: CartInput) {
    cartCreate(input: $input) {
      cart {
        ...CartFields
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const ADD_TO_CART_MUTATION = /* GraphQL */ `
  ${CART_FRAGMENT}
  mutation AddToCart($cartId: ID!, $lines: [CartLineInput!]!) {
    cartLinesAdd(cartId: $cartId, lines: $lines) {
      cart {
        ...CartFields
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const UPDATE_CART_MUTATION = /* GraphQL */ `
  ${CART_FRAGMENT}
  mutation UpdateCart($cartId: ID!, $lines: [CartLineUpdateInput!]!) {
    cartLinesUpdate(cartId: $cartId, lines: $lines) {
      cart {
        ...CartFields
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const REMOVE_FROM_CART_MUTATION = /* GraphQL */ `
  ${CART_FRAGMENT}
  mutation RemoveFromCart($cartId: ID!, $lineIds: [ID!]!) {
    cartLinesRemove(cartId: $cartId, lineIds: $lineIds) {
      cart {
        ...CartFields
      }
      userErrors {
        field
        message
      }
    }
  }
`;

// ─── User error handling ────────────────────────────────────────────────────

interface UserError {
  field: string[];
  message: string;
}

function throwIfUserErrors(errors: UserError[], operation: string): void {
  if (errors.length > 0) {
    const messages = errors
      .map((e) => `${e.field.join('.')}: ${e.message}`)
      .join('\n');
    throw new Error(`[Shopify Cart] ${operation} failed:\n${messages}`);
  }
}

// ─── Cart operations ────────────────────────────────────────────────────────

/**
 * Creates a Shopify cart. Optionally pre-populate with lines and/or
 * top-level attributes so everything ships in one round trip.
 */
export interface CreateCartOptions {
  lines?: CartLineInput[];
  attributes?: CartLineAttribute[];
}

export async function createCart(options: CreateCartOptions = {}): Promise<Cart> {
  const input: Record<string, unknown> = {
    // Pin the cart to the MX market so its subtotal is always priced in MXN
    // (the gate requires it). See STORE_COUNTRY note above.
    buyerIdentity: { countryCode: STORE_COUNTRY },
  };
  if (options.lines?.length) {
    input.lines = options.lines.map((line) => ({
      merchandiseId: line.merchandiseId,
      quantity: line.quantity,
      ...(line.attributes?.length ? { attributes: line.attributes } : {}),
    }));
  }
  if (options.attributes?.length) {
    input.attributes = options.attributes;
  }

  const data = await shopifyFetch<{
    cartCreate: {
      cart: ShopifyCart;
      userErrors: UserError[];
    };
  }>({
    query: CREATE_CART_MUTATION,
    variables: { input }, // always non-empty now (buyerIdentity is always set)
    options: { cache: 'no-store' },
  });

  throwIfUserErrors(data.cartCreate.userErrors, 'cartCreate');
  return reshapeCart(data.cartCreate.cart);
}

/**
 * Adds line items to an existing cart.
 *
 * Each line can include `attributes` for customization data:
 * ```
 * attributes: [
 *   { key: "_preview_image_url", value: "https://..." },
 *   { key: "_grid_type", value: "3x3" },
 *   { key: "category", value: "tonos" },
 *   { key: "_crop_config", value: "{...}" },  // underscore = hidden from customer + retained by webhook filter
 * ]
 * ```
 */
export async function addToCart(
  cartId: string,
  lines: CartLineInput[]
): Promise<Cart> {
  const data = await shopifyFetch<{
    cartLinesAdd: {
      cart: ShopifyCart;
      userErrors: UserError[];
    };
  }>({
    query: ADD_TO_CART_MUTATION,
    variables: {
      cartId,
      lines: lines.map((line) => ({
        merchandiseId: line.merchandiseId,
        quantity: line.quantity,
        ...(line.attributes?.length ? { attributes: line.attributes } : {}),
      })),
    },
    options: { cache: 'no-store' },
  });

  throwIfUserErrors(data.cartLinesAdd.userErrors, 'cartLinesAdd');
  return reshapeCart(data.cartLinesAdd.cart);
}

/**
 * Updates existing line items in a cart (e.g., change quantity).
 */
export async function updateCart(
  cartId: string,
  lines: CartLineUpdateInput[]
): Promise<Cart> {
  const data = await shopifyFetch<{
    cartLinesUpdate: {
      cart: ShopifyCart;
      userErrors: UserError[];
    };
  }>({
    query: UPDATE_CART_MUTATION,
    variables: {
      cartId,
      lines: lines.map((line) => ({
        id: line.id,
        quantity: line.quantity,
        ...(line.merchandiseId ? { merchandiseId: line.merchandiseId } : {}),
        ...(line.attributes?.length ? { attributes: line.attributes } : {}),
      })),
    },
    options: { cache: 'no-store' },
  });

  throwIfUserErrors(data.cartLinesUpdate.userErrors, 'cartLinesUpdate');
  return reshapeCart(data.cartLinesUpdate.cart);
}

/**
 * Removes line items from a cart by their line IDs.
 */
export async function removeFromCart(
  cartId: string,
  lineIds: string[]
): Promise<Cart> {
  const data = await shopifyFetch<{
    cartLinesRemove: {
      cart: ShopifyCart;
      userErrors: UserError[];
    };
  }>({
    query: REMOVE_FROM_CART_MUTATION,
    variables: { cartId, lineIds },
    options: { cache: 'no-store' },
  });

  throwIfUserErrors(data.cartLinesRemove.userErrors, 'cartLinesRemove');
  return reshapeCart(data.cartLinesRemove.cart);
}
