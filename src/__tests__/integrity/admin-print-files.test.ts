/**
 * Phase 5 — Admin print-files R2 gate.
 *
 * Pre-Phase-5, /api/admin/print-files enumerated raw R2 prefixes, so a
 * partial-upload survivor would appear downloadable even though the
 * order's `print_pipeline_status` was `partial` or `failed`. Admin
 * could ship incomplete tiles thinking the order was complete.
 *
 * Phase 5 rewrote the route to:
 *   - read order's print_pipeline_status + print_pipeline_results
 *     metafields via shopifyAdminFetch
 *   - parse R2 keys from result URLs via `parseR2KeyFromPublicUrl`
 *     (no schema bump — Codex audit decision)
 *   - return 200 only when status === 'complete'
 *   - return 409 + retryUrl payload for partial / failed /
 *     unknown_legacy / non-`complete` states
 *
 * These tests exercise the helper directly; the route's HTTP shape is
 * validated by exercising the helper + manual smoke (the route imports
 * a non-trivial slice of Next.js runtime that vitest can't easily
 * boot for a unit test).
 */
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { parseR2KeyFromPublicUrl } from '@/lib/shopify/pipeline-metafields';

describe('parseR2KeyFromPublicUrl — strict R2 URL → {key, index} parser', () => {
  // Snapshot the original env value so beforeEach resets and the
  // 'fallback to default origin' test (which deletes the var) leaves
  // process.env clean for any test that runs after this describe block.
  // Codex final-audit LOW finding.
  let originalR2PublicUrl: string | undefined;

  beforeEach(() => {
    originalR2PublicUrl = process.env.R2_PUBLIC_URL;
    // Match the real producer's URL format: ${R2_PUBLIC_URL}/${key}.
    // Tests run with a fixture host so we know what the gate expects.
    process.env.R2_PUBLIC_URL = 'https://r2.test.mosaiko.mx';
  });

  afterEach(() => {
    if (originalR2PublicUrl === undefined) {
      delete process.env.R2_PUBLIC_URL;
    } else {
      process.env.R2_PUBLIC_URL = originalR2PublicUrl;
    }
  });

  test('valid URL → returns key + parsed index', () => {
    const url =
      'https://r2.test.mosaiko.mx/print-files/order-1234-item-99/tile-7.png';
    expect(parseR2KeyFromPublicUrl(url)).toEqual({
      key: 'print-files/order-1234-item-99/tile-7.png',
      index: 7,
    });
  });

  test('mismatched origin → null (defends against tampered metafield)', () => {
    // Metafield could in theory be edited to point at any URL. The gate
    // must reject anything not on the configured R2 origin so a tampered
    // entry can't redirect the admin proxy to fetch arbitrary content.
    const url =
      'https://attacker.example.com/print-files/order-1234-item-99/tile-0.png';
    expect(parseR2KeyFromPublicUrl(url)).toBeNull();
  });

  test('valid origin but invalid path shape → null', () => {
    // Wrong prefix.
    expect(
      parseR2KeyFromPublicUrl(
        'https://r2.test.mosaiko.mx/cart-composites/abc.png',
      ),
    ).toBeNull();
    // Right prefix, wrong filename.
    expect(
      parseR2KeyFromPublicUrl(
        'https://r2.test.mosaiko.mx/print-files/order-1/abc.png',
      ),
    ).toBeNull();
    // Right prefix + filename, wrong tile-index format.
    expect(
      parseR2KeyFromPublicUrl(
        'https://r2.test.mosaiko.mx/print-files/order-1/tile-X.png',
      ),
    ).toBeNull();
  });

  test('malformed URL → null (does not throw)', () => {
    expect(parseR2KeyFromPublicUrl('not a url')).toBeNull();
    expect(parseR2KeyFromPublicUrl('')).toBeNull();
    expect(parseR2KeyFromPublicUrl(null as unknown as string)).toBeNull();
  });

  test('R2_PUBLIC_URL missing → falls back to default origin', () => {
    delete process.env.R2_PUBLIC_URL;
    // Default per the helper's fallback (matches storage.ts).
    expect(
      parseR2KeyFromPublicUrl(
        'https://r2.mosaiko.mx/print-files/order-9-item-1/tile-3.png',
      ),
    ).toEqual({
      key: 'print-files/order-9-item-1/tile-3.png',
      index: 3,
    });
  });

  test('round-trip with Phase 4 webhook URL format', () => {
    // The webhook stores URLs in print_pipeline_results.urls[i] in
    // exactly this shape. Confirm the parser inverses it.
    const orderId = '123456';
    const lineItemId = 99;
    for (let tileIndex = 0; tileIndex < 9; tileIndex++) {
      const url = `https://r2.test.mosaiko.mx/print-files/order-${orderId}-item-${lineItemId}/tile-${tileIndex}.png`;
      const parsed = parseR2KeyFromPublicUrl(url);
      expect(parsed).not.toBeNull();
      expect(parsed!.index).toBe(tileIndex);
      expect(parsed!.key).toContain(`tile-${tileIndex}.png`);
    }
  });

  // Codex Phase 5 audit MEDIUM fix: cross-order tamper protection.
  // Without bindings, the parser accepted any same-origin
  // print-files/<...>/tile-N.png — a tampered metafield could redirect
  // the admin proxy to fetch ANOTHER order's tiles. With bindings, the
  // key MUST match the canonical shape for THIS (orderId, lineItemId).
  describe('bindings: order/line cross-tamper protection', () => {
    test('valid binding → parses', () => {
      const url =
        'https://r2.test.mosaiko.mx/print-files/order-1234-item-99/tile-7.png';
      expect(
        parseR2KeyFromPublicUrl(url, { orderId: '1234', lineItemId: 99 }),
      ).toEqual({
        key: 'print-files/order-1234-item-99/tile-7.png',
        index: 7,
      });
    });

    test('wrong orderId → null', () => {
      const url =
        'https://r2.test.mosaiko.mx/print-files/order-OTHER-item-99/tile-7.png';
      expect(
        parseR2KeyFromPublicUrl(url, { orderId: '1234', lineItemId: 99 }),
      ).toBeNull();
    });

    test('wrong lineItemId → null', () => {
      const url =
        'https://r2.test.mosaiko.mx/print-files/order-1234-item-77/tile-7.png';
      expect(
        parseR2KeyFromPublicUrl(url, { orderId: '1234', lineItemId: 99 }),
      ).toBeNull();
    });

    test('regex-meaningful chars in orderId are escaped (no false-accept)', () => {
      // Defense against an orderId like '.+' creating a permissive regex
      // that matches any path segment. Should match itself only.
      const url =
        'https://r2.test.mosaiko.mx/print-files/order-1.+-item-99/tile-7.png';
      const otherUrl =
        'https://r2.test.mosaiko.mx/print-files/order-XYZ-item-99/tile-7.png';
      expect(
        parseR2KeyFromPublicUrl(url, { orderId: '1.+', lineItemId: 99 }),
      ).not.toBeNull();
      // The same `.+` orderId should NOT match an unrelated key.
      expect(
        parseR2KeyFromPublicUrl(otherUrl, { orderId: '1.+', lineItemId: 99 }),
      ).toBeNull();
    });

    test('loose mode (no bindings) still parses for back-compat', () => {
      // Tests/non-routing consumers that just want a key+index back.
      const url =
        'https://r2.test.mosaiko.mx/print-files/anything-goes/tile-3.png';
      expect(parseR2KeyFromPublicUrl(url)).toEqual({
        key: 'print-files/anything-goes/tile-3.png',
        index: 3,
      });
    });

    // Codex Phase 5 round-2 audit MEDIUM fix: defense-in-depth against
    // a tampered metafield that puts a regex string in `lineItemId` to
    // bypass the binding. Even if the JSON-shape validator at parse
    // time were skipped, the parser must reject non-integer bindings
    // AND escape the stringified value before regex construction.
    test('non-integer lineItemId binding → null (defense in depth)', () => {
      const url =
        'https://r2.test.mosaiko.mx/print-files/order-1234-item-99/tile-7.png';
      expect(
        parseR2KeyFromPublicUrl(url, {
          orderId: '1234',
          // Cast to bypass TS — simulates a runtime tampered binding.
          lineItemId: 99.5 as unknown as number,
        }),
      ).toBeNull();
      expect(
        parseR2KeyFromPublicUrl(url, {
          orderId: '1234',
          lineItemId: 'evil-string' as unknown as number,
        }),
      ).toBeNull();
    });

    test('regex-meta lineItemId binding (e.g. "99|a") → null', () => {
      // Even if the upstream JSON validator were bypassed and lineItemId
      // arrived as a string with regex meta-characters, the parser must
      // refuse it. Combined with route-side `isWellFormedResult`
      // validation, this is defense in depth.
      const url =
        'https://r2.test.mosaiko.mx/print-files/order-1234-item-99/tile-7.png';
      expect(
        parseR2KeyFromPublicUrl(url, {
          orderId: '1234',
          lineItemId: '99|a' as unknown as number,
        }),
      ).toBeNull();
    });
  });
});
