/**
 * Integrity test: Shopify webhook payload parser
 *
 * The webhook handler at `src/app/api/webhooks/shopify/route.ts` lives
 * behind HMAC verification, a Next.js `after()` background queue, and a
 * handful of live-service integrations (Shopify Admin API, R2, Resend).
 * None of that is under test here — the three pure helpers in
 * `src/lib/shopify/webhook-parser.ts` are.
 *
 * These tests pin the three guarantees the parser must honor:
 *   1. Only `_`-prefixed properties land in the customizedLineItems output
 *      (all human-facing attributes like `grid_type`, `preview_image_url`
 *      must be stripped before processing).
 *   2. Tonos rotations are whitelisted to [0, 90, 180, 270] — anything
 *      else (strings, NaN, 45°, 359°, negative numbers) silently snaps
 *      to 0 rather than passing through to the Sharp pipeline.
 *   3. Malformed JSON inputs return `null` (not throw) so the route can
 *      log + skip a single line item without killing the whole order.
 *
 * The webhook's own failure modes (photo-fetch silent drop, R2 partial
 * upload) are covered in `webhook-failure-modes.test.ts`.
 */
import { describe, test, expect } from 'vitest';
import {
  extractCustomizedLineItems,
  whitelistTonosRotations,
  safeJsonParse,
  type ShopifyOrderWebhook,
} from '@/lib/shopify/webhook-parser';

// ─── Fixtures ──────────────────────────────────────────────────────────────

function mockOrder(overrides?: Partial<ShopifyOrderWebhook>): ShopifyOrderWebhook {
  return {
    id: 5501111111111,
    order_number: 1042,
    name: '#1042',
    email: 'buyer@example.com',
    line_items: [],
    ...overrides,
  };
}

describe('extractCustomizedLineItems', () => {
  test('empty line_items array → empty output', () => {
    expect(extractCustomizedLineItems(mockOrder())).toEqual([]);
  });

  test('line item without any _-prefixed property is dropped', () => {
    const result = extractCustomizedLineItems(
      mockOrder({
        line_items: [
          {
            id: 1,
            title: 'Plain product',
            quantity: 1,
            variant_id: 99,
            properties: [
              { name: 'grid_type', value: 'Personalizado' },
              { name: 'preview_image_url', value: 'https://…' },
            ],
          },
        ],
      }),
    );
    expect(result).toEqual([]);
  });

  test('customized line item → attrs map only contains _-prefixed keys', () => {
    const result = extractCustomizedLineItems(
      mockOrder({
        line_items: [
          {
            id: 100,
            title: 'Mosaico 9 piezas',
            quantity: 2,
            variant_id: 12345,
            properties: [
              // human-facing (dropped by _-prefix filter)
              { name: 'grid_type', value: 'Mosaico 9' },
              { name: 'preview_image_url', value: 'https://r2/…jpg' },
              // internal (retained)
              { name: '_customization', value: '{"categoryType":"mosaicos"}' },
              { name: '_photo_url', value: 'https://r2.mosaiko.mx/uploads/x.jpg' },
              {
                name: '_crop_area',
                value: '{"x":0,"y":0,"width":1,"height":1}',
              },
            ],
          },
        ],
      }),
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      lineItemId: 100,
      title: 'Mosaico 9 piezas',
      quantity: 2,
      attrs: {
        _customization: '{"categoryType":"mosaicos"}',
        _photo_url: 'https://r2.mosaiko.mx/uploads/x.jpg',
        _crop_area: '{"x":0,"y":0,"width":1,"height":1}',
      },
    });
  });

  test('mixed line items — only the customized ones pass through', () => {
    const result = extractCustomizedLineItems(
      mockOrder({
        line_items: [
          {
            id: 1,
            title: 'Plain',
            quantity: 1,
            variant_id: 1,
            properties: [{ name: 'grid_type', value: 'x' }],
          },
          {
            id: 2,
            title: 'Custom',
            quantity: 1,
            variant_id: 2,
            properties: [{ name: '_customization', value: '{}' }],
          },
          {
            id: 3,
            title: 'Plain 2',
            quantity: 1,
            variant_id: 3,
            properties: [],
          },
        ],
      }),
    );
    expect(result.map((r) => r.lineItemId)).toEqual([2]);
  });

  test('Phase 3 BLOCKER fix: predesigned line (no customizations) carries no _ attrs and is dropped', () => {
    // The Phase 3.4 attr rename moved `_preview_image_url`/`_grid_type`
    // into the `_`-prefixed namespace. If those were stamped on EVERY
    // line (including predesigned ones), the webhook's `_`-prefix
    // filter would treat predesigned lines as "customized" and then
    // fail them with `missing_customization_attr`. The producer fix
    // (only stamp `_` display attrs when `customizations` exists) means
    // predesigned lines have ZERO `_` properties → filter drops them
    // entirely → webhook treats them as plain catalog purchases.
    const result = extractCustomizedLineItems(
      mockOrder({
        line_items: [
          {
            id: 50,
            title: 'Mosaico 9 (predesigned)',
            quantity: 1,
            variant_id: 99,
            // Predesigned line: no `_`-prefixed properties at all.
            // (After the Phase 3 BLOCKER fix, `_preview_image_url` and
            // `_grid_type` are NOT stamped here — only on customized lines.)
            properties: [],
          },
        ],
      }),
    );
    expect(result).toEqual([]);
  });

  test('Phase 3.4: _preview_image_url and _grid_type survive the filter', () => {
    // Phase 3.4 renamed `preview_image_url` → `_preview_image_url` and
    // `grid_type` → `_grid_type` at the producer (`checkout.ts`) so they
    // pass the `_`-prefix filter. Pre-Phase-3, these were unprefixed and
    // got dropped — admin UI + email template silently saw `undefined`.
    const result = extractCustomizedLineItems(
      mockOrder({
        line_items: [
          {
            id: 200,
            title: 'Mosaico 9 piezas',
            quantity: 1,
            variant_id: 12345,
            properties: [
              { name: '_preview_image_url', value: 'https://r2/preview.jpg' },
              { name: '_grid_type', value: '3x3' },
              { name: '_customization', value: '{"categoryType":"mosaicos"}' },
              { name: '_photo_url', value: 'https://r2.mosaiko.mx/uploads/x.jpg' },
              { name: '_crop_area', value: '{"x":0,"y":0,"width":1,"height":1}' },
            ],
          },
        ],
      }),
    );
    expect(result).toHaveLength(1);
    expect(result[0].attrs._preview_image_url).toBe('https://r2/preview.jpg');
    expect(result[0].attrs._grid_type).toBe('3x3');
  });

  test('a single _-prefixed key is enough to qualify the line item', () => {
    const result = extractCustomizedLineItems(
      mockOrder({
        line_items: [
          {
            id: 1,
            title: 'Custom',
            quantity: 1,
            variant_id: 2,
            properties: [
              { name: 'grid_type', value: 'Mosaico 9' },
              { name: '_customization', value: '{}' },
            ],
          },
        ],
      }),
    );
    expect(result).toHaveLength(1);
    expect(Object.keys(result[0].attrs)).toEqual(['_customization']);
  });
});

describe('whitelistTonosRotations', () => {
  test('3-slot array with valid quarter-turn rotations round-trips', () => {
    expect(
      whitelistTonosRotations([
        { rotation: 0 },
        { rotation: 90 },
        { rotation: 270 },
      ]),
    ).toEqual([0, 90, 270]);
  });

  test('non-whitelisted rotation snaps to 0 (the whitelist contract)', () => {
    // 45° is a common not-really-intended value from partial drags;
    // 359° / -90° appear when a "rotate left" feature is wired wrong.
    expect(
      whitelistTonosRotations([
        { rotation: 45 },
        { rotation: 359 },
        { rotation: -90 },
      ]),
    ).toEqual([0, 0, 0]);
  });

  test('mixed slot — only the bad entry snaps; good ones survive', () => {
    expect(
      whitelistTonosRotations([
        { rotation: 90 },
        { rotation: 1337 },
        { rotation: 180 },
      ]),
    ).toEqual([90, 0, 180]);
  });

  test('non-numeric rotation snaps to 0', () => {
    expect(
      whitelistTonosRotations([
        { rotation: 'ninety' as unknown as number },
        { rotation: NaN },
        { rotation: null as unknown as number },
      ]),
    ).toEqual([0, 0, 0]);
  });

  test('missing rotation field on a slot defaults to 0', () => {
    expect(
      whitelistTonosRotations([{}, { rotation: 90 }, { rotation: 180 }]),
    ).toEqual([0, 90, 180]);
  });

  test('null slot entry defaults to 0 without throwing', () => {
    expect(
      whitelistTonosRotations([null, { rotation: 90 }, { rotation: 180 }]),
    ).toEqual([0, 90, 180]);
  });

  // Shape-mismatch cases: the whitelist signals "undefined" so the
  // webhook falls back to the processor's no-rotation default instead
  // of smuggling through a partial array.
  test('returns undefined when input is not an array', () => {
    expect(whitelistTonosRotations(undefined)).toBeUndefined();
    expect(whitelistTonosRotations(null)).toBeUndefined();
    expect(whitelistTonosRotations('[0,90,180]')).toBeUndefined();
    expect(whitelistTonosRotations({ 0: 0, 1: 90, 2: 180 })).toBeUndefined();
  });

  test('returns undefined when the array is not exactly length 3', () => {
    expect(whitelistTonosRotations([])).toBeUndefined();
    expect(whitelistTonosRotations([{ rotation: 0 }])).toBeUndefined();
    expect(
      whitelistTonosRotations([{ rotation: 0 }, { rotation: 90 }]),
    ).toBeUndefined();
    expect(
      whitelistTonosRotations([
        { rotation: 0 },
        { rotation: 90 },
        { rotation: 180 },
        { rotation: 270 },
      ]),
    ).toBeUndefined();
  });
});

describe('safeJsonParse', () => {
  test('returns the parsed value for valid JSON', () => {
    expect(safeJsonParse('{"ok":true}')).toEqual({ ok: true });
    expect(safeJsonParse('[1,2,3]')).toEqual([1, 2, 3]);
    expect(safeJsonParse('"hello"')).toBe('hello');
  });

  test('returns null for malformed JSON rather than throwing', () => {
    expect(safeJsonParse('{foo: bar}')).toBeNull();
    expect(safeJsonParse('')).toBeNull();
    expect(safeJsonParse('undefined')).toBeNull();
    expect(safeJsonParse('NaN')).toBeNull();
  });

  test('returns null for truncated JSON (network-cut-off simulation)', () => {
    expect(
      safeJsonParse('{"categoryType":"tonos","tonosSlots":[{"rot'),
    ).toBeNull();
  });

  test('preserves the caller-declared generic type in the output', () => {
    const result = safeJsonParse<{ id: number; name: string }>(
      '{"id":1,"name":"x"}',
    );
    // Type is narrowed; runtime value is the parsed object.
    expect(result?.id).toBe(1);
    expect(result?.name).toBe('x');
  });
});

describe('integration — captured webhook payload → parser output', () => {
  /**
   * A realistic Shopify order-webhook payload containing:
   *   - one plain (non-customized) line item → must be dropped
   *   - one mosaicos line → attrs preserved
   *   - one tonos line → attrs preserved + rotations whitelistable
   * Mirrors what `checkout.ts#buildCartLines` serializes today.
   */
  const fixture: ShopifyOrderWebhook = {
    id: 6001234567890,
    order_number: 2024,
    name: '#2024',
    email: 'realcustomer@example.com',
    line_items: [
      {
        id: 12900000000001,
        title: 'Tarjeta regalo',
        quantity: 1,
        variant_id: 40000000000001,
        properties: [{ name: 'gift_note', value: 'Feliz cumpleaños' }],
      },
      {
        id: 12900000000002,
        title: 'Mosaico personalizado 9 piezas',
        quantity: 1,
        variant_id: 40000000000002,
        properties: [
          { name: 'grid_type', value: 'Mosaico 9' },
          { name: 'preview_image_url', value: 'https://r2.mosaiko.mx/c/abc.jpg' },
          {
            name: '_customization',
            value: JSON.stringify({ categoryType: 'mosaicos', gridSize: 9 }),
          },
          { name: '_photo_url', value: 'https://r2.mosaiko.mx/uploads/one.jpg' },
          {
            name: '_crop_area',
            value: JSON.stringify({ x: 0, y: 0, width: 1, height: 1 }),
          },
        ],
      },
      {
        id: 12900000000003,
        title: 'Tonos 9 piezas',
        quantity: 2,
        variant_id: 40000000000003,
        properties: [
          { name: 'grid_type', value: 'Tonos 9' },
          {
            name: '_customization',
            value: JSON.stringify({
              categoryType: 'tonos',
              gridSize: 9,
              intensity: 'strong',
              tonosSlots: [
                { fitMode: 'fill', rotation: 0 },
                { fitMode: 'fit', rotation: 90 },
                { fitMode: 'stretch', rotation: 270 },
              ],
            }),
          },
          {
            name: '_photo_urls',
            value: JSON.stringify([
              'https://r2.mosaiko.mx/uploads/t1.jpg',
              'https://r2.mosaiko.mx/uploads/t2.jpg',
              'https://r2.mosaiko.mx/uploads/t3.jpg',
            ]),
          },
          {
            name: '_crop_areas',
            value: JSON.stringify([
              { x: 0, y: 0, width: 1, height: 1 },
              { x: 0, y: 0, width: 1, height: 1 },
              { x: 0, y: 0, width: 1, height: 1 },
            ]),
          },
        ],
      },
    ],
  };

  test('two customized items are extracted; the gift card is dropped', () => {
    const out = extractCustomizedLineItems(fixture);
    expect(out.map((i) => i.lineItemId)).toEqual([
      12900000000002, 12900000000003,
    ]);
  });

  test('tonos line: _customization → tonosSlots → whitelistTonosRotations end-to-end', () => {
    const tonosLine = extractCustomizedLineItems(fixture).find(
      (i) => i.title.startsWith('Tonos'),
    )!;
    const customization = safeJsonParse<{
      tonosSlots?: Array<{ rotation?: number }>;
    }>(tonosLine.attrs['_customization']);
    expect(customization).not.toBeNull();
    expect(whitelistTonosRotations(customization!.tonosSlots)).toEqual([
      0, 90, 270,
    ]);
  });
});
