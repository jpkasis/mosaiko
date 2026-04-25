/**
 * Build the per-order pipeline metafield payload. Shared between the
 * webhook route and the admin retry endpoint so both write identical
 * shapes — there is exactly one source of truth for the metafield set
 * that records pipeline status + results + errors + URLs.
 *
 * All metafields are written in one `metafieldsSet` mutation (see
 * `src/lib/shopify/mutations/orders.ts#setOrderMetafields`) so the
 * batch is atomic: either every key is up to date or the prior
 * values remain (no partial-commit window where
 * `print_pipeline_status === 'complete'` but `print_files` is stale).
 */
import type { WebhookOrderResult } from './webhook-processor';
import type { OrderMetafieldWrite } from './mutations/orders';

export function buildPipelineMetafields(
  result: WebhookOrderResult,
): OrderMetafieldWrite[] {
  // Always write every key on every run — including empty arrays for
  // print_files and print_pipeline_errors. Past versions omitted empty
  // keys, which left stale state from prior runs (a partial→complete
  // retry could leave the old errors metafield populated; an ok→failed
  // retry could leave prior URLs visible as print_files). Emitting []
  // explicitly means the upsert fully overwrites the prior state.
  return [
    // Per-line results — authoritative source for retry idempotency.
    {
      namespace: 'mosaiko',
      key: 'print_pipeline_results',
      type: 'json',
      value: JSON.stringify(
        result.results.map((r) =>
          r.kind === 'ok'
            ? { lineItemId: r.lineItemId, kind: 'ok' as const, urls: r.urls }
            : {
                lineItemId: r.lineItemId,
                kind: 'failed' as const,
                reason: r.reason,
                detail: r.detail,
              },
        ),
      ),
    },
    {
      namespace: 'mosaiko',
      key: 'print_files',
      type: 'json',
      value: JSON.stringify(result.allUrls),
    },
    {
      namespace: 'mosaiko',
      key: 'print_pipeline_errors',
      type: 'json',
      value: JSON.stringify(
        result.failures.map((f) => ({
          lineItemId: f.lineItemId,
          title: f.title,
          reason: f.reason,
          detail: f.detail,
        })),
      ),
    },
    // STATUS LAST in the array. metafieldsSet applies the whole batch
    // as one transaction — ordering doesn't affect atomicity — but
    // keeping status last makes the intent ("this is the commit
    // marker for the other metafields") explicit to future readers.
    {
      namespace: 'mosaiko',
      key: 'print_pipeline_status',
      type: 'single_line_text_field',
      value: result.status,
    },
  ];
}

/**
 * Phase 5 — Admin print-files R2 gate (Codex audit decision: parse the
 * R2 key from the public URL rather than schema-bumping the metafield).
 *
 * The webhook stores per-line results as `urls: string[]` where each
 * URL has the form `${R2_PUBLIC_URL}/print-files/order-<orderId>-item-<lineItemId>/tile-<index>.png`
 * (see `src/lib/storage.ts:235` + `processLineItem`'s `jobId`).
 *
 * Codex Phase 5 audit MEDIUM fix: the parser must BIND the key shape to
 * the (orderId, lineItemId) pair the caller expects — otherwise a
 * same-origin tampered metafield could redirect the admin proxy to fetch
 * another order's tiles. Without binding, the regex `/print-files/<any>/tile-N.png`
 * would accept `print-files/order-OTHER-item-1/tile-0.png` from a same-host
 * URL.
 *
 * Strict parser:
 *   - Compares URL origin against `process.env.R2_PUBLIC_URL`.
 *   - Validates the path against the EXACT expected key for this order+line.
 *   - Returns `{ key, index }` for `getObject` consumption + UI ordering.
 *   - Returns `null` on any parse failure (admin route MUST treat this as
 *     a tampered/missing metafield and fail closed with 409).
 */
export function parseR2KeyFromPublicUrl(
  url: string,
  bindings?: { orderId: string; lineItemId: number },
): { key: string; index: number } | null {
  if (!url || typeof url !== 'string') return null;

  const r2Origin =
    process.env.R2_PUBLIC_URL ?? 'https://r2.mosaiko.mx';
  let parsed: URL;
  let originExpected: URL;
  try {
    parsed = new URL(url);
    originExpected = new URL(r2Origin);
  } catch {
    return null;
  }
  if (parsed.origin !== originExpected.origin) return null;

  const key = parsed.pathname.replace(/^\//, '');

  // Cross-order tamper guard: when bindings are supplied, the key MUST
  // match the canonical shape for THIS order+line, not any old
  // `print-files/<...>/tile-N.png`. Backward-compat: omitting bindings
  // still accepts the loose shape (for tests and any non-routing
  // consumer that just wants to extract a key).
  //
  // Codex Phase 5 round-2 audit MEDIUM fix: defense-in-depth — even
  // though the route now validates `Number.isSafeInteger(lineItemId)`
  // before calling us, escape the lineItemId stringification too so a
  // future caller passing a raw value can't smuggle regex metacharacters.
  if (bindings) {
    if (!Number.isSafeInteger(bindings.lineItemId)) return null;
    const expectedRegex = new RegExp(
      `^print-files\\/order-${escapeForRegex(bindings.orderId)}-item-${escapeForRegex(String(bindings.lineItemId))}\\/tile-(\\d+)\\.png$`,
    );
    const match = expectedRegex.exec(key);
    if (!match) return null;
    const index = Number.parseInt(match[1], 10);
    if (!Number.isFinite(index) || index < 0) return null;
    return { key, index };
  }

  // Loose mode (no bindings): just match the deterministic shape.
  const looseMatch = /^print-files\/[\w-]+\/tile-(\d+)\.png$/.exec(key);
  if (!looseMatch) return null;
  const index = Number.parseInt(looseMatch[1], 10);
  if (!Number.isFinite(index) || index < 0) return null;
  return { key, index };
}

function escapeForRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
