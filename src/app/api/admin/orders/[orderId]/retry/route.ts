import { NextRequest, NextResponse } from 'next/server';
import { verifySession } from '@/lib/admin/auth';
import { uploadPrintTiles } from '@/lib/storage';
import {
  processWebhookOrder,
  type ProcessingDeps,
  type PriorLineResult,
} from '@/lib/shopify/webhook-processor';
import type { ShopifyOrderWebhook } from '@/lib/shopify/webhook-parser';

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
  const base = `https://${SHOPIFY_STORE_DOMAIN}/admin/api/2024-01/orders/${orderId}/metafields.json`;

  const writes: Array<{
    key: string;
    value: string;
    type: 'json' | 'single_line_text_field';
  }> = [
    {
      key: 'print_pipeline_status',
      value: result.status,
      type: 'single_line_text_field',
    },
    {
      key: 'print_pipeline_results',
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
      type: 'json',
    },
  ];

  if (result.allUrls.length > 0) {
    writes.push({
      key: 'print_files',
      value: JSON.stringify(result.allUrls),
      type: 'json',
    });
  }
  if (result.failures.length > 0) {
    writes.push({
      key: 'print_pipeline_errors',
      value: JSON.stringify(
        result.failures.map((f) => ({
          lineItemId: f.lineItemId,
          title: f.title,
          reason: f.reason,
          detail: f.detail,
        })),
      ),
      type: 'json',
    });
  }

  for (const mf of writes) {
    await fetch(base, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': SHOPIFY_ADMIN_API_TOKEN,
      },
      body: JSON.stringify({
        metafield: {
          namespace: 'mosaiko',
          key: mf.key,
          value: mf.value,
          type: mf.type,
        },
      }),
    });
  }
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
  };

  const result = await processWebhookOrder(order, deps, { priors });

  try {
    await writePipelineMetafields(orderId, result);
  } catch (error) {
    console.error(
      `[api/admin/orders/retry] Metafield write failed for ${orderId}:`,
      error,
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
