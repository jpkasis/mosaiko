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
  whitelistTonosFitModes,
  safeJsonParse,
  type CustomizedLineItem,
  type ShopifyOrderWebhook,
} from './webhook-parser';
import { PIPELINE_VERSION } from '../print-pipeline/version';
import {
  getCompositeLayout,
  splitCompositeIntoTiles,
} from '../print-pipeline/utils/assemble-tiles';
import { shopifyCdnUrlFilename } from './files';

// Composite-reuse: strict key validator. The cart-composite route now
// uploads via Shopify Files; the storage layer's `flattenToFilename`
// produces `mosaiko-print-files--cart-composites-<jobId>.png`. The cart
// attribute `_composite_key` stores this flattened form (returned by
// `uploadBuffer`), and `_composite_url` carries the cdn.shopify.com URL.
// Anything outside this shape is rejected and the webhook falls back
// to the full pipeline.
const COMPOSITE_KEY_REGEX =
  /^mosaiko-print-files--cart-composites-[\w-]{1,128}\.png$/;

/**
 * Composite-reuse bypass. Runs before the regular processor invocation:
 * if every gate passes (key shape, pipeline version, composite fetch,
 * dimension match), produces tiles by extracting from the composite via
 * `splitCompositeIntoTiles` instead of re-running `processPrintJob`.
 *
 * Returns `null` on any failure — caller falls back to the full pipeline.
 * Never throws; failures are warnings + fall-through, not order failures.
 */
async function tryComposeReuseBypass(
  customization: CategoryCustomization,
  lineItemAttrs: Record<string, string>,
  jobId: string,
  deps: ProcessingDeps,
): Promise<Array<{ index: number; buffer: Buffer; filename: string }> | null> {
  const compositeKey = lineItemAttrs['_composite_key'];
  const compositeVersion = lineItemAttrs['_composite_pipeline_version'];

  if (!compositeKey || !compositeVersion) return null;

  // Pipeline-version gate — Phase 4 will bump PIPELINE_VERSION when font
  // rendering changes; stale carts re-render through processPrintJob so
  // they pick up the new fonts. Cart stores the version stamped at
  // composite-creation time (see /api/cart-composite), not at checkout
  // time, so an item created before a deploy and checked out after
  // correctly carries the OLD version and falls through here.
  if (compositeVersion !== PIPELINE_VERSION) return null;

  // Untrusted-input gate: reject keys that don't match the producer pattern.
  if (!COMPOSITE_KEY_REGEX.test(compositeKey)) {
    console.warn(
      '[webhook] composite-reuse rejected: invalid _composite_key shape',
      { compositeKey },
    );
    return null;
  }

  // Layout — throws if customization is malformed; fall through on any throw.
  let layout;
  try {
    layout = getCompositeLayout(customization);
  } catch (error) {
    console.warn(
      '[webhook] composite-reuse rejected: getCompositeLayout failed',
      { error: String(error) },
    );
    return null;
  }

  // Codex post-Shopify-Files-migration fix: there is no longer a
  // deterministic key→URL mapping (Shopify minted CDN URL is not
  // reconstructable from the filename alone). We must trust the
  // `_composite_url` cart attribute, but ONLY after binding it to
  // `_composite_key` to defend against a tampered cart redirecting the
  // fetch at an attacker-controlled URL. The binding: the URL's
  // basename must equal the validated `_composite_key`.
  const compositeUrl = lineItemAttrs['_composite_url'];
  if (!compositeUrl) return null;
  const urlFilename = shopifyCdnUrlFilename(compositeUrl);
  if (urlFilename !== compositeKey) {
    console.warn(
      '[webhook] composite-reuse rejected: _composite_url does not bind to _composite_key',
      { compositeKey, urlFilename },
    );
    return null;
  }

  // Fetch the composite. fetchPhoto's allow-list includes
  // cdn.shopify.com, so this passes; null means missing or refused.
  // No bypass without the actual composite bytes.
  const composite = await deps.fetchPhoto(compositeUrl);
  if (!composite) return null;

  // Split + dimension check (the helper validates and throws on mismatch).
  let tiles;
  try {
    tiles = await splitCompositeIntoTiles(composite, layout, jobId);
  } catch (error) {
    console.warn(
      '[webhook] composite-reuse rejected: split failed (likely dimension mismatch)',
      { error: String(error) },
    );
    return null;
  }

  if (tiles.length === 0) return null;
  return tiles;
}

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

  /**
   * Delete the cart-composite object after a successful composite-reuse
   * bypass + tile upload. Optional — when absent, composites accumulate
   * until R2 lifecycle policy reaps them. The route wires
   * `deleteFile('print-files', key)`; tests can pass a stub or omit.
   *
   * Failures are non-fatal — caller logs and proceeds.
   */
  deleteComposite?: (key: string) => Promise<void>;
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

  // ── Composite-reuse bypass (Phase 3.1) ─────────────────────────────
  // If the cart already produced a canonical composite via
  // `/api/cart-composite`, we can split it directly into the printed
  // tiles instead of re-running the Sharp processor. Saves the second
  // render and avoids R2 orphans for every successful order. The bypass
  // is category-agnostic — extracting pixel regions from a composite
  // works identically for Mosaicos, Tonos (tones+logo already baked),
  // STD/Arte/Studio (text already rendered), Spotify, and Polaroid.
  //
  // Strict gates: pipeline-version match, key-shape regex, fetch ok,
  // dimension match. Any failure → log + fall through to the full
  // pipeline below. The bypass never throws an order failure on its own.
  const bypassTiles = await tryComposeReuseBypass(
    customization,
    lineItem.attrs,
    jobId,
    deps,
  );
  if (bypassTiles) {
    let stored;
    try {
      stored = await deps.uploadPrintTiles(
        jobId,
        bypassTiles.map((t) => ({ index: t.index, buffer: t.buffer })),
      );
    } catch (error) {
      return fail('tile_upload_error', String(error));
    }
    if (stored.length === 0) {
      return fail('no_tiles_generated');
    }
    // Best-effort R2 cleanup — fire-and-forget. The composite is no
    // longer needed once the tiles are in `print-files/<jobId>/`. We
    // intentionally don't `await` it: a slow R2 delete (or transient
    // failure) shouldn't delay the webhook response or block the next
    // line item's processing. R2 lifecycle policy on `cart-composites/`
    // reaps anything left behind. Codex Phase 3 audit MINOR fix.
    if (deps.deleteComposite) {
      const compositeKey = lineItem.attrs['_composite_key'];
      if (compositeKey) {
        // void: explicit "I am ignoring this promise on purpose."
        void deps.deleteComposite(compositeKey).catch((error) => {
          console.warn(
            '[webhook] composite cleanup failed (non-fatal)',
            { compositeKey, error: String(error) },
          );
        });
      }
    }
    return { kind: 'ok', ...base, urls: stored.map((s) => s.publicUrl) };
  }

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

    // `tonosSlots` is now declared on `TonosCustomization` itself, but
    // the webhook still treats the value as untrusted (it came from a
    // Shopify line-item attribute that any client could in theory
    // tamper with). Whitelist both `rotation` and `fitMode` per slot
    // before forwarding into the print job.
    const slotsRaw = (
      customization as unknown as { tonosSlots?: unknown }
    ).tonosSlots;
    const rotations = whitelistTonosRotations(slotsRaw);
    const fitModes = whitelistTonosFitModes(slotsRaw);

    let printResult;
    try {
      printResult = await deps.processPrintJob({
        imageBuffers: [buffers[0]!, buffers[1]!, buffers[2]!],
        customization,
        cropAreas: [crops[0], crops[1], crops[2]],
        rotations,
        fitModes,
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
