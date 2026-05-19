/**
 * Admin print-files binding/tamper-guard tests.
 *
 * The route reads metafield URLs and exposes downloads ONLY when the URL
 * binds to (orderId, lineItemId) via the canonical filename pattern. A
 * tampered metafield could otherwise:
 *   - point at a non-Shopify origin (data-exfil channel)
 *   - point at a same-origin file belonging to a DIFFERENT order/line
 *     (cross-order leak)
 *   - point at a same-origin garbage filename
 *
 * Post-Shopify-Files migration the canonical filename is
 *   `mosaiko-order-<orderId>-item-<lineItemId>-tile-<index>.png`
 * possibly with a Shopify dedup suffix `_<n>` in case any code path
 * bypasses the `duplicateResolutionMode: REPLACE` we use for tile uploads.
 */
import { describe, test, expect } from 'vitest';
import { parseShopifyFileBindingFromUrl } from '@/lib/shopify/pipeline-metafields';

const SHOP_PREFIX = 'https://cdn.shopify.com/s/files/1/0984/4562/3587/files';

describe('parseShopifyFileBindingFromUrl — cdn.shopify.com URL → {key, index} parser', () => {
  test('valid URL → returns filename + parsed index', () => {
    const url = `${SHOP_PREFIX}/mosaiko-order-1234-item-99-tile-7.png`;
    expect(parseShopifyFileBindingFromUrl(url)).toEqual({
      key: 'mosaiko-order-1234-item-99-tile-7.png',
      index: 7,
    });
  });

  test('valid URL with cache-bust query string still parses', () => {
    const url = `${SHOP_PREFIX}/mosaiko-order-1234-item-99-tile-3.png?v=1778025526`;
    expect(parseShopifyFileBindingFromUrl(url)).toEqual({
      key: 'mosaiko-order-1234-item-99-tile-3.png',
      index: 3,
    });
  });

  test('mismatched origin → null (defends against tampered metafield)', () => {
    // Metafield could in theory be edited to point at any URL. The gate
    // must reject anything not on cdn.shopify.com so a tampered entry
    // can't redirect the admin proxy to fetch arbitrary content.
    const url =
      'https://attacker.example.com/files/mosaiko-order-1234-item-99-tile-0.png';
    expect(parseShopifyFileBindingFromUrl(url)).toBeNull();
  });

  test('cdn.shopify.com origin but path is not /files/* → null', () => {
    expect(
      parseShopifyFileBindingFromUrl(
        'https://cdn.shopify.com/products/mosaiko-order-1-item-1-tile-0.png',
      ),
    ).toBeNull();
  });

  test('valid origin but invalid filename shape → null', () => {
    expect(
      parseShopifyFileBindingFromUrl(`${SHOP_PREFIX}/something-random.png`),
    ).toBeNull();
    expect(
      parseShopifyFileBindingFromUrl(
        `${SHOP_PREFIX}/mosaiko-order-1-item-1-tile-X.png`,
      ),
    ).toBeNull();
    expect(
      parseShopifyFileBindingFromUrl(
        `${SHOP_PREFIX}/mosaiko-order-1-item-1-tile-0.jpg`,
      ),
    ).toBeNull();
  });

  test('malformed URL → null (does not throw)', () => {
    expect(parseShopifyFileBindingFromUrl('not a url')).toBeNull();
    expect(parseShopifyFileBindingFromUrl('')).toBeNull();
    expect(
      parseShopifyFileBindingFromUrl(null as unknown as string),
    ).toBeNull();
  });

  test('round-trip with webhook URL format', () => {
    // The webhook stores URLs in `print_pipeline_results.urls[i]`. Confirm
    // the parser inverses the producer pattern.
    const orderId = '123456';
    const lineItemId = 99;
    for (let tileIndex = 0; tileIndex < 9; tileIndex++) {
      const url = `${SHOP_PREFIX}/mosaiko-order-${orderId}-item-${lineItemId}-tile-${tileIndex}.png?v=42`;
      const parsed = parseShopifyFileBindingFromUrl(url);
      expect(parsed).not.toBeNull();
      expect(parsed!.index).toBe(tileIndex);
      expect(parsed!.key).toContain(`tile-${tileIndex}.png`);
    }
  });

  describe('bindings: order/line cross-tamper protection', () => {
    test('valid binding → parses', () => {
      const url = `${SHOP_PREFIX}/mosaiko-order-1234-item-99-tile-7.png`;
      expect(
        parseShopifyFileBindingFromUrl(url, {
          orderId: '1234',
          lineItemId: 99,
        }),
      ).toEqual({
        key: 'mosaiko-order-1234-item-99-tile-7.png',
        index: 7,
      });
    });

    test('wrong orderId → null', () => {
      const url = `${SHOP_PREFIX}/mosaiko-order-OTHER-item-99-tile-7.png`;
      expect(
        parseShopifyFileBindingFromUrl(url, {
          orderId: '1234',
          lineItemId: 99,
        }),
      ).toBeNull();
    });

    test('wrong lineItemId → null', () => {
      const url = `${SHOP_PREFIX}/mosaiko-order-1234-item-77-tile-7.png`;
      expect(
        parseShopifyFileBindingFromUrl(url, {
          orderId: '1234',
          lineItemId: 99,
        }),
      ).toBeNull();
    });

    test('regex-meaningful chars in orderId are escaped (no false-accept)', () => {
      // Defense against an orderId like '.+' creating a permissive regex
      // that matches any path segment.
      const url = `${SHOP_PREFIX}/mosaiko-order-1.+-item-99-tile-7.png`;
      const otherUrl = `${SHOP_PREFIX}/mosaiko-order-XYZ-item-99-tile-7.png`;
      expect(
        parseShopifyFileBindingFromUrl(url, {
          orderId: '1.+',
          lineItemId: 99,
        }),
      ).not.toBeNull();
      expect(
        parseShopifyFileBindingFromUrl(otherUrl, {
          orderId: '1.+',
          lineItemId: 99,
        }),
      ).toBeNull();
    });

    test('loose mode (no bindings) still parses for back-compat', () => {
      const url = `${SHOP_PREFIX}/mosaiko-order-anything-item-77-tile-3.png`;
      expect(parseShopifyFileBindingFromUrl(url)).toEqual({
        key: 'mosaiko-order-anything-item-77-tile-3.png',
        index: 3,
      });
    });

    test('non-integer lineItemId binding → null (defense in depth)', () => {
      const url = `${SHOP_PREFIX}/mosaiko-order-1234-item-99-tile-7.png`;
      expect(
        parseShopifyFileBindingFromUrl(url, {
          orderId: '1234',
          lineItemId: 99.5 as unknown as number,
        }),
      ).toBeNull();
      expect(
        parseShopifyFileBindingFromUrl(url, {
          orderId: '1234',
          lineItemId: 'evil-string' as unknown as number,
        }),
      ).toBeNull();
    });

    test('regex-meta lineItemId binding (e.g. "99|a") → null', () => {
      const url = `${SHOP_PREFIX}/mosaiko-order-1234-item-99-tile-7.png`;
      expect(
        parseShopifyFileBindingFromUrl(url, {
          orderId: '1234',
          lineItemId: '99|a' as unknown as number,
        }),
      ).toBeNull();
    });
  });

  describe('Shopify duplicate-resolution suffix tolerance', () => {
    // Print tiles upload with `duplicateResolutionMode: REPLACE` so a
    // suffix should never appear. The bounded `(?:_[A-Za-z0-9-]{1,80})?`
    // is defense-in-depth in case any code path bypasses REPLACE
    // (Shopify's default APPEND_UUID would emit a UUID suffix).
    test('numeric dedup suffix (_2) → still binds', () => {
      const url = `${SHOP_PREFIX}/mosaiko-order-1234-item-99-tile-7_2.png`;
      expect(
        parseShopifyFileBindingFromUrl(url, {
          orderId: '1234',
          lineItemId: 99,
        }),
      ).toEqual({
        key: 'mosaiko-order-1234-item-99-tile-7_2.png',
        index: 7,
      });
    });

    test('UUID-like dedup suffix → still binds (loose tolerance)', () => {
      const url = `${SHOP_PREFIX}/mosaiko-order-1234-item-99-tile-7_a1b2c3d4-0123.png`;
      expect(
        parseShopifyFileBindingFromUrl(url, {
          orderId: '1234',
          lineItemId: 99,
        }),
      ).toEqual({
        key: 'mosaiko-order-1234-item-99-tile-7_a1b2c3d4-0123.png',
        index: 7,
      });
    });

    test('overly long suffix (>80 chars) → null (safety bound)', () => {
      const longSuffix = 'a'.repeat(81);
      const url = `${SHOP_PREFIX}/mosaiko-order-1234-item-99-tile-7_${longSuffix}.png`;
      expect(
        parseShopifyFileBindingFromUrl(url, {
          orderId: '1234',
          lineItemId: 99,
        }),
      ).toBeNull();
    });
  });

  describe('basename-extraction edge cases', () => {
    test('encoded slash in path → null (defense against tamper)', () => {
      // A tampered URL could try to encode `/` as `%2F` in the path to
      // fool a naive `split('/').pop()`. The decoded basename would
      // contain a slash; we reject.
      const url = `${SHOP_PREFIX}/mosaiko%2Forder-1-item-1-tile-0.png`;
      expect(parseShopifyFileBindingFromUrl(url)).toBeNull();
    });

    test('empty basename → null', () => {
      const url = `${SHOP_PREFIX}/`;
      expect(parseShopifyFileBindingFromUrl(url)).toBeNull();
    });
  });
});
