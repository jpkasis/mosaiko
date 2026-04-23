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
  const writes: OrderMetafieldWrite[] = [
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
  ];
  if (result.allUrls.length > 0) {
    writes.push({
      namespace: 'mosaiko',
      key: 'print_files',
      type: 'json',
      value: JSON.stringify(result.allUrls),
    });
  }
  if (result.failures.length > 0) {
    writes.push({
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
    });
  }
  // STATUS LAST in the array. metafieldsSet applies the whole batch as
  // one transaction — ordering doesn't affect atomicity — but keeping
  // status last makes the intent ("this is the commit marker for the
  // other metafields") explicit for future readers.
  writes.push({
    namespace: 'mosaiko',
    key: 'print_pipeline_status',
    type: 'single_line_text_field',
    value: result.status,
  });
  return writes;
}
