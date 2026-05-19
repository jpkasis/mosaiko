import { NextRequest, NextResponse, after } from 'next/server';
import crypto from 'node:crypto';
import { uploadPrintTiles, deleteFile } from '@/lib/storage';
import {
  extractCustomizedLineItems,
  type ShopifyOrderWebhook,
} from '@/lib/shopify/webhook-parser';
import {
  processWebhookOrder,
  type ProcessingDeps,
  type WebhookOrderResult,
  type PriorLineResult,
} from '@/lib/shopify/webhook-processor';
import { setOrderMetafields } from '@/lib/shopify/mutations/orders';
import {
  buildPipelineMetafields,
  applyPipelineOrderTags,
} from '@/lib/shopify/pipeline-metafields';
import {
  getAdminAccessToken,
  isAdminConfigured,
  SHOPIFY_API_VERSION,
} from '@/lib/shopify/client';

// ─── Environment ─────────────────────────────────────────────────────────────

const SHOPIFY_WEBHOOK_SECRET = process.env.SHOPIFY_WEBHOOK_SECRET!;
const SHOPIFY_STORE_DOMAIN =
  process.env.SHOPIFY_STORE_DOMAIN ??
  process.env.NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN ??
  '';

// ─── HMAC verification ──────────────────────────────────────────────────────

/**
 * Verifies the Shopify webhook HMAC-SHA256 signature.
 * Compares the computed HMAC against the X-Shopify-Hmac-Sha256 header
 * using timing-safe comparison to prevent timing attacks.
 */
function verifyShopifyHmac(rawBody: string, hmacHeader: string): boolean {
  const computed = crypto
    .createHmac('sha256', SHOPIFY_WEBHOOK_SECRET)
    .update(rawBody, 'utf8')
    .digest('base64');

  // Both must be the same length for timingSafeEqual
  const computedBuffer = Buffer.from(computed, 'utf8');
  const receivedBuffer = Buffer.from(hmacHeader, 'utf8');

  if (computedBuffer.length !== receivedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(computedBuffer, receivedBuffer);
}

// ─── Shopify Admin API — metafield writes ──────────────────────────────────

/**
 * Atomically upsert the pipeline-result metafields on the order.
 *
 * Uses the GraphQL `metafieldsSet` mutation — one call, one
 * transaction. Prior to this rewrite, writes went through
 * `POST .../metafields.json` which CREATES (does not upsert). Repeated
 * webhook retries on the same order accumulated duplicate metafields
 * with the same (namespace, key), and the first-row lookup in the
 * idempotency gate could read a stale status.
 */
async function updateOrderMetafields(
  orderId: number,
  result: WebhookOrderResult,
): Promise<void> {
  if (!SHOPIFY_STORE_DOMAIN || !isAdminConfigured()) {
    console.warn(
      '[webhook/shopify] Shopify Admin API not configured, skipping metafield update',
    );
    return;
  }

  const orderGid = `gid://shopify/Order/${orderId}`;
  const writes = buildPipelineMetafields(result);
  await setOrderMetafields(orderGid, writes);
  // Apply / clear pipeline-status order tags so failures + partials
  // surface in Shopify Admin's order list (and on the local admin
  // panel's Fallidos badge). Best-effort — never rolls back a
  // metafield write, just logs on failure.
  await applyPipelineOrderTags(orderGid, result.status);
}

/**
 * Idempotency gate. Previous implementation skipped any order whose
 * `print_files` metafield existed — silently consuming retries of
 * partial or failed runs. New behaviour: only skip when
 * `print_pipeline_status === 'complete'`. Any other status (including
 * 'partial' and 'failed') permits the retry to proceed, which is the
 * whole point of the pipeline-status metafield existing.
 */
async function isOrderAlreadyComplete(orderId: number): Promise<boolean> {
  if (!SHOPIFY_STORE_DOMAIN || !isAdminConfigured()) return false;
  try {
    const url = `https://${SHOPIFY_STORE_DOMAIN}/admin/api/${SHOPIFY_API_VERSION}/orders/${orderId}/metafields.json?namespace=mosaiko&key=print_pipeline_status`;
    const res = await fetch(url, {
      headers: { 'X-Shopify-Access-Token': await getAdminAccessToken() },
    });
    if (!res.ok) return false;
    const data = (await res.json()) as {
      metafields?: Array<{ value?: string }>;
    };
    const status = data.metafields?.[0]?.value;
    return status === 'complete';
  } catch (error) {
    // Fail open on the idempotency check: safer to retry than to skip
    // an order that may still need tiles.
    console.warn('[webhook/shopify] Idempotency check failed, proceeding:', error);
    return false;
  }
}

/**
 * Read the `print_pipeline_results` metafield written by a prior run.
 * Returns only the successful prior results — the orchestrator's
 * `priors` parameter is how we avoid re-doing already-completed line
 * items. Failed priors are discarded (we want them retried).
 *
 * Returns `undefined` on any error, which makes the orchestrator
 * behave as a fresh run (safe fallback).
 */
async function readPriorSuccesses(
  orderId: number,
): Promise<PriorLineResult[] | undefined> {
  if (!SHOPIFY_STORE_DOMAIN || !isAdminConfigured()) return undefined;
  try {
    const url = `https://${SHOPIFY_STORE_DOMAIN}/admin/api/${SHOPIFY_API_VERSION}/orders/${orderId}/metafields.json?namespace=mosaiko&key=print_pipeline_results`;
    const res = await fetch(url, {
      headers: { 'X-Shopify-Access-Token': await getAdminAccessToken() },
    });
    if (!res.ok) return undefined;
    const data = (await res.json()) as {
      metafields?: Array<{ value?: string }>;
    };
    const raw = data.metafields?.[0]?.value;
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as PriorLineResult[];
    return parsed.filter((p) => p.kind === 'ok');
  } catch (error) {
    console.warn(
      '[webhook/shopify] Prior-results read failed, running as fresh:',
      error,
    );
    return undefined;
  }
}

// ─── SSRF prevention: only fetch from trusted origins ───────────────────────
//
// Post-Shopify-Files migration: every photo (originals, cart composites,
// print tiles) lives on `cdn.shopify.com`. The legacy `r2.mosaiko.mx`
// host is no longer in the allowlist; pre-migration carts (if any
// exist) will fail closed and fall back to "no composite reuse".

const ALLOWED_PHOTO_HOSTS = new Set(['cdn.shopify.com']);
const FETCH_TIMEOUT_MS = 15_000;
const MAX_IMAGE_SIZE = 20 * 1024 * 1024;

function isAllowedPhotoUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && ALLOWED_PHOTO_HOSTS.has(parsed.hostname);
  } catch {
    return false;
  }
}

async function fetchPhotoBuffer(url: string): Promise<Buffer | null> {
  if (!isAllowedPhotoUrl(url)) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_IMAGE_SIZE) return null;
    return buf;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

// ─── POST /api/webhooks/shopify ─────────────────────────────────────────────

export async function POST(request: NextRequest) {
  // ── Read raw body for HMAC verification ─────────────────────────────

  const rawBody = await request.text();
  const hmacHeader = request.headers.get('X-Shopify-Hmac-Sha256');

  if (!hmacHeader) {
    return NextResponse.json(
      { error: 'Missing HMAC signature header' },
      { status: 401 },
    );
  }

  // ── Verify HMAC ───────────────────────────────────────────────────────

  if (!verifyShopifyHmac(rawBody, hmacHeader)) {
    console.error('[webhook/shopify] HMAC verification failed');
    return NextResponse.json(
      { error: 'Invalid HMAC signature' },
      { status: 401 },
    );
  }

  // ── Parse order payload ───────────────────────────────────────────────

  let order: ShopifyOrderWebhook;
  try {
    order = JSON.parse(rawBody) as ShopifyOrderWebhook;
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON payload' },
      { status: 400 },
    );
  }

  // ── Extract customized line items ─────────────────────────────────────

  const customizedItems = extractCustomizedLineItems(order);

  if (customizedItems.length === 0) {
    // No custom photo items in this order -- nothing to process
    return NextResponse.json({ status: 'ok', message: 'No custom items' });
  }

  // ── Process line items ────────────────────────────────────────────────
  //
  // Respond immediately (Shopify requires 200 within 5s) and process
  // tiles in the background using Next.js after() for guaranteed completion.
  const response = NextResponse.json({
    status: 'accepted',
    orderId: order.id,
    orderNumber: order.order_number,
    customItemCount: customizedItems.length,
  });

  // Process in the background — after() guarantees completion even after response
  after(async () => {
    // Idempotency: skip only if a prior run completed all items
    if (await isOrderAlreadyComplete(order.id)) {
      console.log(
        `[webhook/shopify] Order ${order.order_number}: already complete (idempotency), skipping`,
      );
      return;
    }

    // Lazy-load the Sharp pipeline — keeps cold-start cost off the
    // HMAC-rejection path.
    const { processPrintJob } = await import('@/lib/print-pipeline');
    const deps: ProcessingDeps = {
      fetchPhoto: fetchPhotoBuffer,
      uploadPrintTiles,
      processPrintJob: processPrintJob as ProcessingDeps['processPrintJob'],
      // Phase 3.1c — clean up cart-composite after successful split + upload.
      deleteComposite: (key) => deleteFile('print-files', key),
    };

    // Per-line idempotency: on a retry, reuse URLs from lines that
    // already completed successfully in a prior run.
    const priors = await readPriorSuccesses(order.id);

    const result = await processWebhookOrder(order, deps, { priors });

    // Persist pipeline result to Shopify metafields. Always writes
    // `print_pipeline_status`, even on 'failed' runs, so the next retry
    // knows where it stands.
    try {
      await updateOrderMetafields(order.id, result);
    } catch (error) {
      console.error(
        `[webhook/shopify] Failed to write metafields for order ${order.order_number}:`,
        error,
      );
    }

    // Customer-facing email is now Shopify-native (the order/paid
    // webhook is downstream of Shopify's own order-confirmation
    // notification, which fires automatically on payment). Admin
    // failure visibility is the order-tag set applied via
    // `applyPipelineOrderTags` above — no per-failure email.

    console.log(
      `[webhook/shopify] Order ${order.order_number}: status=${result.status} tiles=${result.allUrls.length} failures=${result.failures.length}`,
    );
  });

  return response;
}
