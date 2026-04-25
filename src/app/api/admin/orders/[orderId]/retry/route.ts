import { NextRequest, NextResponse } from 'next/server';
import { verifySession } from '@/lib/admin/auth';
import { uploadPrintTiles, deleteFile } from '@/lib/storage';
import {
  processWebhookOrder,
  type ProcessingDeps,
  type PriorLineResult,
} from '@/lib/shopify/webhook-processor';
import type { ShopifyOrderWebhook } from '@/lib/shopify/webhook-parser';
import { setOrderMetafields } from '@/lib/shopify/mutations/orders';
import { buildPipelineMetafields } from '@/lib/shopify/pipeline-metafields';

// ─── Env ────────────────────────────────────────────────────────────────────

const SHOPIFY_ADMIN_API_TOKEN = process.env.SHOPIFY_ADMIN_API_TOKEN!;
const SHOPIFY_STORE_DOMAIN =
  process.env.SHOPIFY_STORE_DOMAIN ??
  process.env.NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN ??
  '';

const R2_PUBLIC_DOMAIN = process.env.R2_PUBLIC_URL
  ? new URL(process.env.R2_PUBLIC_URL).hostname
  : 'r2.mosaiko.mx';

const ALLOWED_PHOTO_HOSTS = new Set([R2_PUBLIC_DOMAIN, 'cdn.shopify.com']);
const FETCH_TIMEOUT_MS = 15_000;
const MAX_IMAGE_SIZE = 20 * 1024 * 1024;

// ─── Helpers (mirror the webhook route's SSRF + photo fetch) ────────────────

function isAllowedPhotoUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === 'https:' && ALLOWED_PHOTO_HOSTS.has(parsed.hostname)
    );
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

async function fetchOrderFromShopify(
  orderId: string,
): Promise<ShopifyOrderWebhook | null> {
  if (!SHOPIFY_STORE_DOMAIN || !SHOPIFY_ADMIN_API_TOKEN) return null;
  const url = `https://${SHOPIFY_STORE_DOMAIN}/admin/api/2024-01/orders/${orderId}.json`;
  const res = await fetch(url, {
    headers: { 'X-Shopify-Access-Token': SHOPIFY_ADMIN_API_TOKEN },
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { order?: ShopifyOrderWebhook };
  return data.order ?? null;
}

async function readPriorSuccesses(
  orderId: string,
): Promise<PriorLineResult[]> {
  if (!SHOPIFY_STORE_DOMAIN || !SHOPIFY_ADMIN_API_TOKEN) return [];
  const url = `https://${SHOPIFY_STORE_DOMAIN}/admin/api/2024-01/orders/${orderId}/metafields.json?namespace=mosaiko&key=print_pipeline_results`;
  const res = await fetch(url, {
    headers: { 'X-Shopify-Access-Token': SHOPIFY_ADMIN_API_TOKEN },
  });
  if (!res.ok) return [];
  const data = (await res.json()) as {
    metafields?: Array<{ value?: string }>;
  };
  const raw = data.metafields?.[0]?.value;
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as PriorLineResult[];
    return parsed.filter((p) => p.kind === 'ok');
  } catch {
    return [];
  }
}

async function writePipelineMetafields(
  orderId: string,
  result: Awaited<ReturnType<typeof processWebhookOrder>>,
): Promise<void> {
  const orderGid = `gid://shopify/Order/${orderId}`;
  await setOrderMetafields(orderGid, buildPipelineMetafields(result));
}

// ─── POST /api/admin/orders/[orderId]/retry ─────────────────────────────────
//
// Manually re-run the print pipeline for a partial/failed order. Successful
// lines from the prior run are reused via the orchestrator's `priors`
// parameter so only the failed lines actually re-process. Writes updated
// metafields and returns the new status + per-line outcomes.
//
// No admin-UI surface in this PR; callable via curl from the admin dash.

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ orderId: string }> },
) {
  const isAdmin = await verifySession();
  if (!isAdmin) {
    return NextResponse.json({ error: 'No autorizado.' }, { status: 401 });
  }

  const { orderId } = await params;
  if (!/^\d+$/.test(orderId)) {
    return NextResponse.json(
      { error: 'orderId debe ser numérico (Shopify REST order ID).' },
      { status: 400 },
    );
  }

  const order = await fetchOrderFromShopify(orderId);
  if (!order) {
    return NextResponse.json(
      { error: 'Orden no encontrada en Shopify.' },
      { status: 404 },
    );
  }

  const priors = await readPriorSuccesses(orderId);

  const { processPrintJob } = await import('@/lib/print-pipeline');
  const deps: ProcessingDeps = {
    fetchPhoto: fetchPhotoBuffer,
    uploadPrintTiles,
    processPrintJob: processPrintJob as ProcessingDeps['processPrintJob'],
    deleteComposite: (key) => deleteFile('print-files', key),
  };

  const result = await processWebhookOrder(order, deps, { priors });

  try {
    await writePipelineMetafields(orderId, result);
  } catch (error) {
    // Do NOT return 200 on metafield-write failure — the client sees
    // the new tile URLs but Shopify's source of truth is still stale,
    // and a follow-up retry would wrongly reuse the prior state.
    // Bubble the failure to the admin so they can intervene.
    console.error(
      `[api/admin/orders/retry] Metafield write failed for ${orderId}:`,
      error,
    );
    return NextResponse.json(
      {
        orderId,
        error: 'metafield_write_failed',
        detail: error instanceof Error ? error.message : String(error),
        pipelineStatus: result.status,
        tilesProduced: result.allUrls.length,
      },
      { status: 500 },
    );
  }

  return NextResponse.json({
    orderId,
    status: result.status,
    tilesProduced: result.allUrls.length,
    failures: result.failures.map((f) => ({
      lineItemId: f.lineItemId,
      title: f.title,
      reason: f.reason,
      detail: f.detail,
    })),
    reusedFromPriors: priors.length,
  });
}
