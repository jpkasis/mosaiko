import { NextRequest, NextResponse } from 'next/server';
import archiver from 'archiver';
import { Readable } from 'node:stream';
import { verifySession } from '@/lib/admin/auth';
import { parseShopifyFileBindingFromUrl } from '@/lib/shopify/pipeline-metafields';
import {
  getAdminAccessToken,
  isAdminConfigured,
  SHOPIFY_API_VERSION,
} from '@/lib/shopify/client';

async function fetchTileBytes(publicUrl: string): Promise<Buffer> {
  const res = await fetch(publicUrl);
  if (!res.ok) {
    throw new Error(
      `[admin/print-files] fetch ${publicUrl} → HTTP ${res.status}`,
    );
  }
  return Buffer.from(await res.arrayBuffer());
}

// ─── GET /api/admin/print-files ─────────────────────────────────────────────
//
// Phase 5 (Appendix I) rewrite: status-gated, metafield-driven.
//
// Pre-Phase-5, this endpoint enumerated raw R2 prefixes via `listFiles`.
// That returned WHATEVER R2 had at that prefix — including partial-upload
// survivors from prior failed runs — and the admin UI happily showed
// them as downloadable. An admin shipping a `partial`/`failed` order
// would silently include incomplete tiles.
//
// Now: read the order's `print_pipeline_status` + `print_pipeline_results`
// metafields; expose downloads ONLY when status === 'complete'; parse R2
// keys from the URLs in `results[].urls` (no schema bump — see
// `parseR2KeyFromPublicUrl`); return 409 + retry CTA payload for
// partial/failed/missing-metafield states.
//
// Auth: JWT cookie (admin session)
//
// Query params:
//   orderId      (required)  — Shopify numeric order id (no `gid://` prefix)
//   format       (optional)  — `'zip'` to stream a ZIP of all tiles
//   lineItemId   (optional)  — single-tile download scope
//   tile         (optional)  — single tile index within `lineItemId`

const SHOPIFY_STORE_DOMAIN =
  process.env.SHOPIFY_STORE_DOMAIN ??
  process.env.NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN;
const ORDER_ID_PATTERN = /^[0-9]+$/;

interface OkLineResult {
  lineItemId: number;
  kind: 'ok';
  urls: string[];
}
interface FailedLineResult {
  lineItemId: number;
  kind: 'failed';
  reason?: string;
  detail?: string;
}
type PriorLineResult = OkLineResult | FailedLineResult;

interface MetafieldRead {
  status: string | null;
  results: PriorLineResult[] | null;
}

async function readPipelineMetafields(orderId: string): Promise<MetafieldRead | null> {
  if (!SHOPIFY_STORE_DOMAIN || !isAdminConfigured()) return null;
  const baseUrl = `https://${SHOPIFY_STORE_DOMAIN}/admin/api/${SHOPIFY_API_VERSION}/orders/${orderId}/metafields.json`;
  const token = await getAdminAccessToken();

  // Two parallel reads (status + results) by namespace+key. Other
  // metafields (errors, files) are written by the same atomic mutation,
  // so trusting status + results is sufficient for the gating logic.
  const [statusRes, resultsRes] = await Promise.all([
    fetch(`${baseUrl}?namespace=mosaiko&key=print_pipeline_status`, {
      headers: { 'X-Shopify-Access-Token': token },
      cache: 'no-store',
    }),
    fetch(`${baseUrl}?namespace=mosaiko&key=print_pipeline_results`, {
      headers: { 'X-Shopify-Access-Token': token },
      cache: 'no-store',
    }),
  ]);
  if (!statusRes.ok || !resultsRes.ok) return null;

  const statusJson = (await statusRes.json()) as {
    metafields?: { value?: string }[];
  };
  const resultsJson = (await resultsRes.json()) as {
    metafields?: { value?: string }[];
  };

  const status = statusJson.metafields?.[0]?.value ?? null;
  let results: PriorLineResult[] | null = null;
  const resultsRaw = resultsJson.metafields?.[0]?.value;
  if (resultsRaw) {
    try {
      const parsed = JSON.parse(resultsRaw) as unknown;
      if (Array.isArray(parsed) && parsed.every(isWellFormedResult)) {
        results = parsed as PriorLineResult[];
      }
    } catch {
      // Malformed metafield: return null for results, fall through to
      // unknown_legacy treatment by the route.
    }
  }
  return { status, results };
}

/**
 * Codex Phase 5 round-2 audit MEDIUM fix: validate the per-line shape
 * at parse time. A tampered metafield could put a regex string into
 * `lineItemId` to bypass the parseR2KeyFromPublicUrl key-binding
 * regex. Stricter at parse time + escaped binding in the parser =
 * defense in depth.
 */
function isWellFormedResult(r: unknown): r is PriorLineResult {
  if (!r || typeof r !== 'object') return false;
  const x = r as Record<string, unknown>;
  if (!Number.isSafeInteger(x.lineItemId)) return false;
  if (x.kind === 'ok') {
    return Array.isArray(x.urls) && x.urls.every((u) => typeof u === 'string');
  }
  if (x.kind === 'failed') return true;
  return false;
}

interface TileDescriptor {
  index: number;
  key: string;
  /** Public R2 URL for in-app img preview. Distinct from the proxied
   *  download URL (which streams via this route to attach the
   *  Content-Disposition header for the admin's download flow). */
  publicUrl: string;
  downloadUrl: string;
}
interface LineDescriptor {
  lineItemId: number;
  jobId: string;
  tiles: TileDescriptor[];
}

/**
 * Codex Phase 5 audit HIGH fix: validate the FULL results shape before
 * returning 200. Pre-fix, a tampered metafield with status='complete'
 * but a wrong-origin or wrong-prefix URL would produce a partial 200
 * (the broken URLs got silently filtered out). Now: any failed line,
 * any zero-tile ok line, OR any URL that doesn't bind to the canonical
 * `print-files/order-${orderId}-item-${lineItemId}/tile-N.png` shape
 * → returns null, caller fails closed with 409.
 */
function buildLines(
  orderId: string,
  results: PriorLineResult[],
): LineDescriptor[] | null {
  const lines: LineDescriptor[] = [];
  for (const r of results) {
    // Any failed line under a `complete` status is a metafield
    // inconsistency — fail closed.
    if (r.kind === 'failed') return null;
    // Empty `ok` line — the webhook never writes this, so its
    // appearance signals a tampered or partially-applied metafield.
    if (!r.urls || r.urls.length === 0) return null;

    const tiles: TileDescriptor[] = [];
    for (const url of r.urls) {
      const parsed = parseShopifyFileBindingFromUrl(url, {
        orderId,
        lineItemId: r.lineItemId,
      });
      // Strict: any URL that doesn't bind to (orderId, lineItemId) is
      // a tamper signal. Don't silently drop — fail the whole listing.
      if (!parsed) return null;
      tiles.push({
        index: parsed.index,
        key: parsed.key,
        publicUrl: url,
        downloadUrl: `/api/admin/print-files?orderId=${encodeURIComponent(
          orderId,
        )}&lineItemId=${r.lineItemId}&tile=${parsed.index}`,
      });
    }
    tiles.sort((a, b) => a.index - b.index);
    lines.push({
      lineItemId: r.lineItemId,
      jobId: `order-${orderId}-item-${r.lineItemId}`,
      tiles,
    });
  }
  return lines;
}

export async function GET(request: NextRequest) {
  try {
    const isAdmin = await verifySession();
    if (!isAdmin) {
      return NextResponse.json({ error: 'No autorizado.' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const orderId = searchParams.get('orderId');
    const format = searchParams.get('format');
    const lineItemIdParam = searchParams.get('lineItemId');
    const tileParam = searchParams.get('tile');

    if (!orderId) {
      return NextResponse.json(
        { error: 'Falta el parámetro orderId.' },
        { status: 400 },
      );
    }
    if (!ORDER_ID_PATTERN.test(orderId)) {
      return NextResponse.json(
        { error: 'Formato de orderId inválido.' },
        { status: 400 },
      );
    }

    let meta: MetafieldRead | null;
    try {
      meta = await readPipelineMetafields(orderId);
    } catch (error) {
      // Codex Phase 5 audit LOW fix: distinguish Shopify/env failures
      // from "metafields legitimately missing". Mapping config errors
      // to `unknown_legacy` would mislead admins into clicking retry
      // when the real problem is the Shopify Admin API or env vars.
      console.error('[api/admin/print-files] Shopify read failed:', error);
      return NextResponse.json(
        {
          status: 'shopify_unavailable',
          message:
            'No se pudo consultar Shopify. Verifica las credenciales o intenta más tarde.',
        },
        { status: 502 },
      );
    }

    // Codex Phase 5 audit LOW fix: explicit shopify_unavailable when
    // env vars are missing (readPipelineMetafields returns null). The
    // generic unknown_legacy retry CTA was misleading in this case.
    if (meta === null) {
      return NextResponse.json(
        {
          status: 'shopify_unavailable',
          message:
            'Shopify Admin API no está configurado. Contacta al administrador.',
        },
        { status: 503 },
      );
    }

    // Missing metafields entirely → unknown legacy state. Codex's
    // explicit policy: do NOT fall back to listing R2 (that's the bug
    // we're fixing). Surface a retry CTA instead.
    if (meta.status === null) {
      return NextResponse.json(
        {
          status: 'unknown_legacy',
          message:
            'El pedido no tiene estado de procesamiento (probablemente anterior a Phase 4). Reintenta el procesamiento.',
          retryUrl: `/api/admin/orders/${orderId}/retry`,
        },
        { status: 409 },
      );
    }

    // Status gate. Only `complete` orders expose downloads.
    if (meta.status !== 'complete') {
      return NextResponse.json(
        {
          status: meta.status,
          message: `Pedido en estado '${meta.status}'. Reintenta antes de descargar.`,
          retryUrl: `/api/admin/orders/${orderId}/retry`,
        },
        { status: 409 },
      );
    }

    if (!meta.results || meta.results.length === 0) {
      return NextResponse.json(
        {
          status: 'unknown_legacy',
          message:
            'Estado complete pero sin resultados por línea. Reintenta el procesamiento.',
          retryUrl: `/api/admin/orders/${orderId}/retry`,
        },
        { status: 409 },
      );
    }

    // Codex Phase 5 audit HIGH fix: validate the FULL results shape via
    // buildLines's strict checks. ANY failed line under a 'complete'
    // status, ANY zero-tile ok line, OR ANY URL that doesn't bind to
    // (orderId, lineItemId) → buildLines returns null, we 409.
    const lines = buildLines(orderId, meta.results);
    if (lines === null) {
      return NextResponse.json(
        {
          status: 'metafield_inconsistent',
          message:
            'El estado de Shopify no coincide con los resultados (posible inconsistencia o manipulación). Reintenta el procesamiento.',
          retryUrl: `/api/admin/orders/${orderId}/retry`,
        },
        { status: 409 },
      );
    }

    // Codex Phase 5 audit LOW fix: strict numeric regex for query
    // params. `parseInt('123abc')` returns 123 silently — this lets
    // `?tile=0a` slip past validation. Reject anything that isn't all
    // digits.
    const NUMERIC_PATTERN = /^[0-9]+$/;

    // ── Single-tile download ──────────────────────────────────────────
    if (lineItemIdParam !== null && tileParam !== null) {
      if (
        !NUMERIC_PATTERN.test(lineItemIdParam) ||
        !NUMERIC_PATTERN.test(tileParam)
      ) {
        return NextResponse.json(
          { error: 'lineItemId / tile deben ser numéricos.' },
          { status: 400 },
        );
      }
      const lineItemId = Number.parseInt(lineItemIdParam, 10);
      const tileIndex = Number.parseInt(tileParam, 10);
      const line = lines.find((l) => l.lineItemId === lineItemId);
      if (!line) {
        return NextResponse.json(
          { error: 'Línea no encontrada.' },
          { status: 404 },
        );
      }
      const tile = line.tiles.find((t) => t.index === tileIndex);
      if (!tile) {
        return NextResponse.json(
          { error: `Tile ${tileIndex} no encontrado.` },
          { status: 404 },
        );
      }

      const bytes = await fetchTileBytes(tile.publicUrl);
      return new NextResponse(new Uint8Array(bytes), {
        headers: {
          'Content-Type': 'image/png',
          'Content-Disposition': `attachment; filename="line-${lineItemId}-tile-${tileIndex}.png"`,
        },
      });
    }

    // ── ZIP all tiles across all lines ─────────────────────────────────
    if (format === 'zip') {
      const archive = archiver('zip', { zlib: { level: 5 } });
      for (const line of lines) {
        for (const tile of line.tiles) {
          const bytes = await fetchTileBytes(tile.publicUrl);
          // Prefix filename with line-id so multi-line orders don't
          // collide on `tile-0.png`. Single-line orders still get
          // sortable, descriptive filenames.
          archive.append(bytes, {
            name: `line-${line.lineItemId}/tile-${tile.index}.png`,
          });
        }
      }
      archive.finalize();
      const readable = Readable.toWeb(archive) as ReadableStream;
      return new NextResponse(readable, {
        headers: {
          'Content-Type': 'application/zip',
          'Content-Disposition': `attachment; filename="mosaiko-pedido-${orderId}.zip"`,
        },
      });
    }

    // ── Default: return the structured listing ────────────────────────
    return NextResponse.json({
      orderId,
      status: meta.status,
      lines,
    });
  } catch (error) {
    console.error('[api/admin/print-files] Error:', error);
    return NextResponse.json(
      { error: 'Error al obtener archivos de impresión.' },
      { status: 500 },
    );
  }
}
