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
