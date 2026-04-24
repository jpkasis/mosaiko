/**
 * Per-order webhook processing orchestrator.
 *
 * Splits out from `src/app/api/webhooks/shopify/route.ts` so the
 * failure-mode behaviour (photo fetch, tile upload, per-line-item
 * success/failure) can be unit-tested without booting Next.js.
 *
 * The route handler wires real I/O via the `ProcessingDeps` bag; tests
 * inject mocks and assert on the returned `WebhookOrderResult`.
 *
 * Key contract change vs. the previous inline implementation:
 *   - `processLineItem` returns a typed `LineItemResult` discriminated
 *     union, not an overloaded `string[]` where empty could mean "no
 *     tiles because photo-fetch failed" OR "no tiles because nothing
 *     was supposed to be uploaded". Callers switch on `kind`.
 *   - `processWebhookOrder` bundles per-line results with an overall
 *     `OrderPipelineStatus` so the route can set order-level metafields
 *     and the admin email can enumerate the failed lines.
 */
import type { CategoryCustomization } from '../customization-types';
import type { CropArea } from '../canvas-utils';
import {
  extractCustomizedLineItems,
  whitelistTonosRotations,
  safeJsonParse,
  type CustomizedLineItem,
  type ShopifyOrderWebhook,
} from './webhook-parser';

// ─── Result shapes ──────────────────────────────────────────────────────────

export type LineItemFailureReason =
  | 'missing_customization_attr'
  | 'customization_parse_error'
  | 'missing_photo_attrs'
  | 'photo_attr_parse_error'
  | 'tonos_slot_count_mismatch'
  | 'photo_fetch_failed'
  | 'crop_parse_error'
  | 'print_pipeline_error'
  | 'tile_upload_error'
  | 'no_tiles_generated';

export interface LineItemOk {
  kind: 'ok';
  lineItemId: number;
  title: string;
  quantity: number;
  urls: string[];
}

export interface LineItemFailed {
  kind: 'failed';
  lineItemId: number;
  title: string;
  quantity: number;
  reason: LineItemFailureReason;
  detail?: string;
}

export type LineItemResult = LineItemOk | LineItemFailed;

export type OrderPipelineStatus = 'complete' | 'partial' | 'failed' | 'empty';

export interface WebhookOrderResult {
  status: OrderPipelineStatus;
  results: LineItemResult[];
  allUrls: string[];
  /** Subset of results with kind==='failed'. Convenience for callers. */
  failures: LineItemFailed[];
}

// ─── Processing dependencies (injected for testability) ─────────────────────

export interface ProcessingDeps {
  /**
   * Fetch a photo buffer from an allow-listed origin. Must return null
   * on any failure (network, timeout, oversize, non-allow-listed host).
   * Throwing is reserved for unexpected programmer errors.
   */
  fetchPhoto: (url: string) => Promise<Buffer | null>;

  /**
   * Upload per-tile PNG buffers to R2. Returns `{ key, publicUrl }` per
   * tile. Must throw on any failure; callers translate throws into
   * typed `LineItemFailed` results.
   */
  uploadPrintTiles: (
    jobId: string,
    tiles: { index: number; buffer: Buffer }[],
  ) => Promise<{ key: string; publicUrl: string }[]>;

  /**
   * Run the Sharp print pipeline. The route passes the real
   * `processPrintJob` from `@/lib/print-pipeline`; tests pass a stub.
   *
   * The processor accepts a wide union of jobs; we keep the deps-level
   * signature permissive on purpose — the webhook only cares about the
   * `tiles[]` output.
   */
  processPrintJob: (job: unknown) => Promise<{
    tiles: Array<{ index: number; buffer: Buffer; filename: string }>;
  }>;
}

// ─── Line-item processing ───────────────────────────────────────────────────

/**
 * Process a single customized line item. Returns a discriminated result
 * so the order-level orchestrator can decide between "write all URLs to
 * a complete metafield", "write partial URLs + flag the order as
 * partial", or "don't write any URLs + flag failed".
 */
export async function processLineItem(
  orderId: number,
  lineItem: CustomizedLineItem,
  deps: ProcessingDeps,
): Promise<LineItemResult> {
  const base = {
    lineItemId: lineItem.lineItemId,
    title: lineItem.title,
    quantity: lineItem.quantity,
  };
  const fail = (
    reason: LineItemFailureReason,
    detail?: string,
  ): LineItemFailed => ({ kind: 'failed', ...base, reason, detail });

  const customizationRaw = lineItem.attrs['_customization'];
  if (!customizationRaw) {
    return fail('missing_customization_attr');
  }

  const customization = safeJsonParse<CategoryCustomization>(customizationRaw);
  if (!customization) {
    return fail('customization_parse_error');
  }

  const jobId = `order-${orderId}-item-${lineItem.lineItemId}`;

  // ── Tonos (multi-image) ────────────────────────────────────────────
  if (customization.categoryType === 'tonos') {
    const urlsRaw = lineItem.attrs['_photo_urls'];
    const cropsRaw = lineItem.attrs['_crop_areas'];
    if (!urlsRaw || !cropsRaw) return fail('missing_photo_attrs');

    const urls = safeJsonParse<string[]>(urlsRaw);
    const crops = safeJsonParse<CropArea[]>(cropsRaw);
    if (!urls || !crops) return fail('photo_attr_parse_error');
    if (urls.length !== 3 || crops.length !== 3) {
      return fail(
        'tonos_slot_count_mismatch',
        `urls.length=${urls.length}, crops.length=${crops.length}`,
      );
    }

    const buffers = await Promise.all(urls.map(deps.fetchPhoto));
    if (buffers.some((b) => !b)) {
      const missing = buffers
        .map((b, i) => (b ? null : i))
        .filter((i): i is number => i !== null);
      return fail('photo_fetch_failed', `slots=${missing.join(',')}`);
    }

    const slotsRaw = (
      customization as unknown as { tonosSlots?: unknown }
    ).tonosSlots;
    const rotations = whitelistTonosRotations(slotsRaw);

    let printResult;
    try {
      printResult = await deps.processPrintJob({
        imageBuffers: [buffers[0]!, buffers[1]!, buffers[2]!],
        customization,
        cropAreas: [crops[0], crops[1], crops[2]],
        rotations,
        jobId,
      });
    } catch (error) {
      return fail('print_pipeline_error', String(error));
    }

    if (!printResult.tiles || printResult.tiles.length === 0) {
      return fail('no_tiles_generated');
    }

    let stored;
    try {
      stored = await deps.uploadPrintTiles(
        jobId,
        printResult.tiles.map((t) => ({ index: t.index, buffer: t.buffer })),
      );
    } catch (error) {
      return fail('tile_upload_error', String(error));
    }

    if (stored.length === 0) {
      return fail('no_tiles_generated');
    }

    return { kind: 'ok', ...base, urls: stored.map((s) => s.publicUrl) };
  }

  // ── Single-image categories ─────────────────────────────────────────
  const photoUrl = lineItem.attrs['_photo_url'];
  const cropAreaRaw = lineItem.attrs['_crop_area'];
  if (!photoUrl || !cropAreaRaw) return fail('missing_photo_attrs');

  const cropArea = safeJsonParse<CropArea>(cropAreaRaw);
  if (!cropArea) return fail('crop_parse_error');

  const imageBuffer = await deps.fetchPhoto(photoUrl);
  if (!imageBuffer) return fail('photo_fetch_failed');

  let printResult;
  try {
    printResult = await deps.processPrintJob({
      imageBuffer,
      customization,
      cropArea,
      jobId,
    });
  } catch (error) {
    return fail('print_pipeline_error', String(error));
  }

  if (!printResult.tiles || printResult.tiles.length === 0) {
    return fail('no_tiles_generated');
  }

  let stored;
  try {
    stored = await deps.uploadPrintTiles(
      jobId,
      printResult.tiles.map((t) => ({ index: t.index, buffer: t.buffer })),
    );
  } catch (error) {
    return fail('tile_upload_error', String(error));
  }

  if (stored.length === 0) {
    return fail('no_tiles_generated');
  }

  return { kind: 'ok', ...base, urls: stored.map((s) => s.publicUrl) };
}

// ─── Order-level orchestration ──────────────────────────────────────────────

/**
 * Priors the orchestrator reads before running any line. Lets the
 * caller (the Shopify webhook handler) carry forward successful line
 * results from a prior run so a retry doesn't redo work that already
 * landed in R2.
 */
export interface PriorLineResult {
  lineItemId: number;
  kind: 'ok' | 'failed';
  urls?: string[];
  reason?: LineItemFailureReason;
  detail?: string;
}

/**
 * Process every customized line item in an order. Isolates errors
 * per line so one failure never kills downstream items, and computes
 * an overall `OrderPipelineStatus` the caller uses to drive:
 *   - `print_pipeline_status` metafield on the order
 *   - admin notification email body ("N of M items failed — ...")
 *   - idempotency gate (only 'complete' should mark the order done;
 *     'partial' + 'failed' should permit retry)
 *
 * If `priors` is provided, any line with a prior result of kind 'ok'
 * is **reused** — its URLs flow straight into `allUrls` without
 * re-fetching, re-processing, or re-uploading. Prior failures are
 * always retried. This is how BLOCKER #2 Phase 4 per-line
 * idempotency is implemented: a retry only re-does the missing
 * tiles, not the whole order.
 */
export async function processWebhookOrder(
  order: ShopifyOrderWebhook,
  deps: ProcessingDeps,
  options: { priors?: PriorLineResult[] } = {},
): Promise<WebhookOrderResult> {
  const items = extractCustomizedLineItems(order);
  if (items.length === 0) {
    return { status: 'empty', results: [], allUrls: [], failures: [] };
  }

  // Index priors by lineItemId so lookup is O(1) per item.
  const priorByLine = new Map<number, PriorLineResult>();
  for (const p of options.priors ?? []) priorByLine.set(p.lineItemId, p);

  const results: LineItemResult[] = [];
  for (const item of items) {
    // Short-circuit: if a prior run successfully processed this line,
    // reuse its URLs. No photo fetch, no Sharp work, no R2 write.
    const prior = priorByLine.get(item.lineItemId);
    if (prior && prior.kind === 'ok' && prior.urls && prior.urls.length > 0) {
      results.push({
        kind: 'ok',
        lineItemId: item.lineItemId,
        title: item.title,
        quantity: item.quantity,
        urls: prior.urls,
      });
      continue;
    }

    let result: LineItemResult;
    try {
      result = await processLineItem(order.id, item, deps);
    } catch (error) {
      // The individual handlers catch their own deps throws and return
      // typed LineItemFailed. An uncaught throw here is a programmer
      // error — coerce to a typed failure so the order-level shape
      // remains total.
      result = {
        kind: 'failed',
        lineItemId: item.lineItemId,
        title: item.title,
        quantity: item.quantity,
        reason: 'print_pipeline_error',
        detail: `unexpected: ${String(error)}`,
      };
    }
    results.push(result);
  }

  const failures = results.filter(
    (r): r is LineItemFailed => r.kind === 'failed',
  );
  const allUrls = results.flatMap((r) => (r.kind === 'ok' ? r.urls : []));

  let status: OrderPipelineStatus;
  if (failures.length === 0) status = 'complete';
  else if (failures.length === results.length) status = 'failed';
  else status = 'partial';

  return { status, results, allUrls, failures };
}
