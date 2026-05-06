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
import { shopifyCdnUrlFilename } from './files';
import { addOrderTags, removeOrderTags } from './mutations/orders';

// ─── Order-tag conventions ──────────────────────────────────────────────────
//
// The two tags used as "failure visibility" markers on orders. Listed
// together so the retry path can ALWAYS-remove both (it doesn't have to
// know which one a previous run set).

export const PIPELINE_FAILED_TAG = 'print-pipeline-failed';
export const PIPELINE_PARTIAL_TAG = 'print-pipeline-partial';
const ALL_PIPELINE_TAGS = [PIPELINE_FAILED_TAG, PIPELINE_PARTIAL_TAG];

/**
 * Apply or remove pipeline-status tags on an order based on the latest
 * pipeline result. Idempotent:
 *   - On `failed`: add PIPELINE_FAILED_TAG, remove PIPELINE_PARTIAL_TAG.
 *   - On `partial`: add PIPELINE_PARTIAL_TAG, remove PIPELINE_FAILED_TAG.
 *   - On `complete` or `empty`: remove both tags.
 *
 * Failures are surfaced as logged warnings rather than throws — the
 * tags are an OBSERVABILITY signal, not the source of truth (the
 * metafield is). Failing to set a tag must not roll back the
 * pipeline result.
 */
export async function applyPipelineOrderTags(
  orderGid: string,
  status: WebhookOrderResult['status'],
): Promise<void> {
  try {
    if (status === 'failed') {
      await addOrderTags(orderGid, [PIPELINE_FAILED_TAG]);
      await removeOrderTags(orderGid, [PIPELINE_PARTIAL_TAG]);
    } else if (status === 'partial') {
      await addOrderTags(orderGid, [PIPELINE_PARTIAL_TAG]);
      await removeOrderTags(orderGid, [PIPELINE_FAILED_TAG]);
    } else {
      // complete / empty — clear both tags so a previously tagged
      // order looks clean after a successful retry.
      await removeOrderTags(orderGid, ALL_PIPELINE_TAGS);
    }
  } catch (error) {
    console.warn(
      `[pipeline-metafields] applyPipelineOrderTags failed for ${orderGid} (status=${status}):`,
      error,
    );
  }
}

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
 * Parser/binding-check for cdn.shopify.com URLs stored in the
 * `print_pipeline_results` metafield.
 *
 * Goal — defend the admin download path against tampered metafields. A
 * compromised metafield could in theory point at:
 *   - a wrong-host URL (attacker-controlled origin)
 *   - a same-host URL belonging to a DIFFERENT order/line (cross-order
 *     leak)
 *   - a same-host URL with garbage filename
 *
 * Defenses:
 *   1. Origin must be `https://cdn.shopify.com`.
 *   2. The path must point at the `/files/<filename>` namespace.
 *   3. The filename must match the canonical pattern produced by
 *      `buildPrintTileFilename` in `src/lib/storage.ts`:
 *
 *        mosaiko-order-<orderId>-item-<lineItemId>-tile-<index>.png
 *
 *      with optional Shopify dedup suffix `_<n>` before the extension
 *      (Shopify renames colliding filenames on re-upload).
 *
 * Returns `{ key, index }` on success; `null` on any binding mismatch.
 * The route MUST treat `null` as a tampered/missing metafield and 409.
 *
 * `key` is the Shopify filename (the value the storage layer accepts as
 * its key argument), so the route can pipe the result straight into
 * `getObject('print-files', key)` without further translation.
 */
export function parseShopifyFileBindingFromUrl(
  url: string,
  bindings?: { orderId: string; lineItemId: number },
): { key: string; index: number } | null {
  if (!url || typeof url !== 'string') return null;
  const filename = shopifyCdnUrlFilename(url);
  if (!filename) return null;

  if (bindings) {
    if (!Number.isSafeInteger(bindings.lineItemId)) return null;
    // Print tiles are uploaded with `duplicateResolutionMode: REPLACE`
    // so a retry overwrites in place — we should never see a Shopify
    // dedup suffix on a tile URL. The bounded `(?:_[A-Za-z0-9-]{1,80})?`
    // is kept as defense-in-depth in case any code path bypasses
    // REPLACE (Shopify's default is APPEND_UUID, which would emit a
    // UUID suffix; matching it lets the binding still validate).
    const escapedOrderId = escapeForRegex(bindings.orderId);
    const escapedLineItemId = escapeForRegex(String(bindings.lineItemId));
    const expected = new RegExp(
      `^mosaiko-order-${escapedOrderId}-item-${escapedLineItemId}-tile-(\\d+)(?:_[A-Za-z0-9-]{1,80})?\\.png$`,
    );
    const match = expected.exec(filename);
    if (!match) return null;
    const index = Number.parseInt(match[1], 10);
    if (!Number.isFinite(index) || index < 0) return null;
    return { key: filename, index };
  }

  // Loose mode (no bindings): match the deterministic shape WITHOUT
  // checking which order/line it belongs to. Used by tests and the
  // generic listing path.
  const looseMatch =
    /^mosaiko-order-[\w-]+-item-\d+-tile-(\d+)(?:_[A-Za-z0-9-]{1,80})?\.png$/.exec(
      filename,
    );
  if (!looseMatch) return null;
  const index = Number.parseInt(looseMatch[1], 10);
  if (!Number.isFinite(index) || index < 0) return null;
  return { key: filename, index };
}

/**
 * @deprecated Renamed to `parseShopifyFileBindingFromUrl` after the
 * R2 → Shopify Files migration. Re-exported here so any straggler
 * imports keep compiling; new code should use the new name.
 */
export const parseR2KeyFromPublicUrl = parseShopifyFileBindingFromUrl;

function escapeForRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
