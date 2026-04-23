/**
 * Pure helpers for parsing the Shopify order-webhook payload.
 *
 * Lives outside `src/app/api/webhooks/shopify/route.ts` so the parsing
 * logic can be unit-tested without spinning up a Next.js request/response
 * cycle. The route handler imports these and keeps its own HMAC +
 * background-processing orchestration.
 */

export interface ShopifyLineItemProperty {
  name: string;
  value: string;
}

export interface ShopifyLineItem {
  id: number;
  title: string;
  quantity: number;
  variant_id: number;
  properties: ShopifyLineItemProperty[];
}

export interface ShopifyOrderWebhook {
  id: number;
  order_number: number;
  name: string;
  email: string;
  line_items: ShopifyLineItem[];
}

export interface CustomizedLineItem {
  lineItemId: number;
  title: string;
  quantity: number;
  attrs: Record<string, string>;
}

/**
 * Extract line items that carry Mosaiko customization attributes.
 *
 * Convention: customization attributes use keys prefixed with `_`. Any
 * line item with at least one `_`-prefixed property is considered
 * customized. All non-underscore properties are dropped from `attrs`.
 */
export function extractCustomizedLineItems(
  order: ShopifyOrderWebhook,
): CustomizedLineItem[] {
  return order.line_items
    .filter((item) =>
      item.properties.some((prop) => prop.name.startsWith('_')),
    )
    .map((item) => {
      const attrs: Record<string, string> = {};
      for (const prop of item.properties) {
        if (prop.name.startsWith('_')) {
          attrs[prop.name] = prop.value;
        }
      }
      return {
        lineItemId: item.id,
        title: item.title,
        quantity: item.quantity,
        attrs,
      };
    });
}

/**
 * Whitelist Tonos per-slot rotations to the four quarter-turns the
 * server pipeline supports: 0°, 90°, 180°, 270°. Anything else snaps
 * to 0. Accepts the raw value from the customization JSON (may be
 * undefined, non-numeric, or a slot array of the wrong length).
 *
 * Returns `undefined` when the input isn't a 3-slot array so callers
 * can fall back to the processor's default (no rotation).
 */
export function whitelistTonosRotations(
  slotsRaw: unknown,
): [number, number, number] | undefined {
  if (!Array.isArray(slotsRaw) || slotsRaw.length !== 3) return undefined;
  const allowed = [0, 90, 180, 270];
  const rs = slotsRaw.map((s) => {
    const rot = (s as { rotation?: unknown } | null | undefined)?.rotation;
    const num = typeof rot === 'number' ? rot : 0;
    return allowed.includes(num) ? num : 0;
  });
  return [rs[0], rs[1], rs[2]];
}

/**
 * Safe JSON parse — returns `null` on malformed input instead of
 * throwing. Matches the current webhook fallback behaviour (log + skip
 * the line item) but surfaces the failure as a typed result the route
 * can switch on.
 */
export function safeJsonParse<T = unknown>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}
