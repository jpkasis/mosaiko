/**
 * Storage layer — backed by Shopify Files API.
 *
 * The contract preserves the legacy R2/S3 surface so consumers don't
 * have to change much, but the semantics differ:
 *
 *   - There is one Shopify Files namespace; the `bucket` parameter is
 *     decorative — used only to derive a flat filename prefix so the
 *     two "buckets" don't collide.
 *   - `key` is a flat filename (no slashes). Print tiles encode their
 *     (orderId, lineItemId, index) into the filename via the
 *     `mosaiko-order-<orderId>-item-<lineItemId>-tile-<index>.png`
 *     convention so the binding regex on read-back can enforce
 *     cross-order tamper protection.
 *   - `publicUrl` is the cdn.shopify.com URL Shopify returns. There is
 *     no way to reconstruct it from the filename alone — callers MUST
 *     persist the URL directly in the metafield/cart attribute and
 *     never rebuild it from the key. `getPublicUrl(key)` was the legacy
 *     sync API for that and now THROWS to surface stragglers.
 *   - Print tiles are uploaded with `duplicateResolutionMode: REPLACE`,
 *     which means a retry of the same (orderId, lineItemId, index)
 *     overwrites the prior file in place — no `_2` / `_<uuid>` dedup
 *     suffix accumulates and no orphan tiles linger.
 *
 * Partial-failure semantics of `uploadPrintTiles` are preserved as a
 * coarse contract: any tile failure (upload, poll-to-READY, server
 * error) propagates as `UploadFailure` carrying the per-tile breakdown.
 * The Shopify primitive (`uploadShopifyFilesBatch`) does best-effort
 * cleanup of any partially-created Shopify files, so the orphan-tile
 * concern from the R2 era is now handled inside the upload primitive
 * rather than left to the orchestrator.
 */

import crypto from 'node:crypto';
import {
  uploadShopifyFile,
  uploadShopifyFilesBatch,
  findShopifyFileByFilename,
  listShopifyFilesByPrefix,
  deleteShopifyFileById,
  type ShopifyUploadResult,
} from './shopify/files';

// ─── Filename conventions ───────────────────────────────────────────────────

const FILENAME_SAFE = /^[\w.-]{1,128}$/;

function sanitizeFilenameSegment(segment: string, label: string): string {
  if (!FILENAME_SAFE.test(segment)) {
    throw new Error(
      `[storage] Invalid ${label}: must be alphanumeric/-/_/. (max 128)`,
    );
  }
  return segment;
}

/**
 * Flatten a legacy `bucket` + `key` (path-with-slashes) pair into a
 * single Shopify filename. Used by the back-compat shims for callers
 * that still pass a slash-bearing key (cart-composites, deferred
 * admin product CRUD).
 */
export function flattenToFilename(
  bucket: 'uploads' | 'print-files',
  key: string,
): string {
  const cleaned = key.replace(/^\/+/, '');
  return `mosaiko-${bucket}--${cleaned.replace(/\//g, '-')}`;
}

/**
 * Canonical print-tile filename. The `jobId` shape is
 * `order-<orderId>-item-<lineItemId>` (set in webhook-processor). The
 * filename is the binding the admin route uses to verify a metafield
 * URL belongs to (orderId, lineItemId).
 */
export function buildPrintTileFilename(jobId: string, index: number): string {
  const safeJob = sanitizeFilenameSegment(jobId, 'jobId');
  if (!Number.isInteger(index) || index < 0) {
    throw new Error(`[storage] Invalid tile index: ${index}`);
  }
  return `mosaiko-${safeJob}-tile-${index}.png`;
}

// ─── Upload original photo ──────────────────────────────────────────────────

const CONTENT_TYPE_BY_EXT: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

export async function uploadOriginalPhoto(
  file: Buffer,
  extension: string,
): Promise<{ key: string; publicUrl: string }> {
  const safeExt = sanitizeFilenameSegment(extension.toLowerCase(), 'extension');
  const uuid = crypto.randomUUID();
  const filename = `mosaiko-original-${uuid}.${safeExt}`;
  const contentType = CONTENT_TYPE_BY_EXT[safeExt] ?? 'application/octet-stream';
  const result = await uploadShopifyFile(filename, contentType, file, {
    // Originals are unique by UUID; REPLACE is harmless and keeps the
    // filename predictable in case of a UUID collision (vanishingly
    // unlikely but cheap to defend against).
    duplicateResolutionMode: 'REPLACE',
  });
  return { key: result.filename, publicUrl: result.url };
}

// ─── Upload print tiles ─────────────────────────────────────────────────────

export class UploadFailure extends Error {
  readonly succeeded: { index: number; key: string; publicUrl: string }[];
  readonly failed: { index: number; reason: string }[];

  constructor(params: {
    succeeded: { index: number; key: string; publicUrl: string }[];
    failed: { index: number; reason: string }[];
  }) {
    super(
      `uploadPrintTiles: ${params.failed.length} of ${
        params.failed.length + params.succeeded.length
      } tiles failed`,
    );
    this.name = 'UploadFailure';
    this.succeeded = params.succeeded;
    this.failed = params.failed;
  }
}

/**
 * Uploads N print tiles in a single staged-upload + fileCreate batch.
 * Either every tile lands READY (full success → returns the array) or
 * the entire batch is rolled back at the Shopify Files level
 * (best-effort delete of any IDs that were created) and an
 * `UploadFailure` is thrown.
 *
 * Note that with the batch primitive, partial-success at the Shopify
 * level is rare: stagedUploadsCreate / fileCreate are atomic across
 * the inputs, and `waitUntilAllReady` either gets all-READY or throws
 * on the first FAILED/timeout. The `UploadFailure` shape is preserved
 * because callers (orchestrator + retry route) already discriminate
 * on `succeeded[]` / `failed[]`, but practically the shape will be
 * "all succeeded" or "all failed" rather than mixed.
 */
export async function uploadPrintTiles(
  jobId: string,
  tiles: { index: number; buffer: Buffer }[],
): Promise<{ key: string; publicUrl: string }[]> {
  if (tiles.length === 0) return [];

  const inputs = tiles.map((tile) => ({
    filename: buildPrintTileFilename(jobId, tile.index),
    mimeType: 'image/png',
    buffer: tile.buffer,
    duplicateResolutionMode: 'REPLACE' as const,
  }));

  try {
    const out = await uploadShopifyFilesBatch(inputs);
    return out.map((r) => ({ key: r.filename, publicUrl: r.url }));
  } catch (error) {
    // Batch primitive throws on any tile failure after best-effort
    // cleanup. We surface the error as a typed UploadFailure so
    // callers (webhook orchestrator + retry endpoint) can route it
    // through their existing failure-classification path.
    const reason = error instanceof Error ? error.message : String(error);
    throw new UploadFailure({
      succeeded: [],
      failed: tiles.map((t) => ({ index: t.index, reason })),
    });
  }
}

// ─── Public-URL helpers ─────────────────────────────────────────────────────

/**
 * Legacy synchronous "public URL from key" call. With Shopify Files
 * there is no deterministic mapping from filename to cdn URL, so
 * callers MUST persist the URL returned by the upload functions and
 * use that. This stub throws to surface latent callers.
 *
 * (Codex audit flagged two callers — one in webhook-processor.ts that
 * has been fixed in the migration, and one in the deferred
 * product-store.ts that's commented out per the launch plan.)
 */
export function getPublicUrl(_key: string): string {
  throw new Error(
    '[storage] getPublicUrl(key) is no longer supported. Shopify Files does not expose a deterministic key→URL mapping; persist the publicUrl returned by uploadShopifyFile / uploadBuffer / uploadPrintTiles, or look up the file via findShopifyFileByFilename.',
  );
}

/**
 * Async `getSignedUrl` shim — historically presigned an R2 URL with a
 * TTL. Shopify Files URLs are public and persistent; this resolves the
 * key to its current cdn URL and ignores `expiresIn`.
 */
export async function getSignedUrl(
  key: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  expiresIn: number = 3600,
  bucket: 'uploads' | 'print-files' = 'uploads',
): Promise<string> {
  let found = await findShopifyFileByFilename(key);
  if (!found && key.includes('/')) {
    found = await findShopifyFileByFilename(flattenToFilename(bucket, key));
  }
  if (!found) {
    throw new Error(`[storage] getSignedUrl: file not found for key '${key}'`);
  }
  return found.url;
}

// ─── Object retrieval (admin download proxy fallback) ───────────────────────

export interface StorageGetObjectResponse {
  Body: {
    transformToByteArray(): Promise<Uint8Array>;
    transformToString(): Promise<string>;
  };
}

/**
 * S3-shaped read for callers that don't already have the URL. Two
 * calls (filename lookup + CDN fetch). Acceptable for the admin
 * download path (low traffic, behind JWT). The print-files admin
 * route prefers fetching the metafield URL directly — see
 * `src/app/api/admin/print-files/route.ts`.
 */
export async function getObject(
  bucket: 'uploads' | 'print-files',
  key: string,
): Promise<StorageGetObjectResponse> {
  let found = await findShopifyFileByFilename(key);
  if (!found && key.includes('/')) {
    found = await findShopifyFileByFilename(flattenToFilename(bucket, key));
  }
  if (!found) {
    const err = new Error(
      `[storage] getObject: file not found for key '${key}'`,
    );
    (err as Error & { name: string }).name = 'NoSuchKey';
    throw err;
  }
  const res = await fetch(found.url);
  if (!res.ok) {
    throw new Error(
      `[storage] getObject: fetch ${found.url} → HTTP ${res.status}`,
    );
  }
  const buf = Buffer.from(await res.arrayBuffer());
  return {
    Body: {
      async transformToByteArray() {
        return new Uint8Array(buf);
      },
      async transformToString() {
        return buf.toString('utf8');
      },
    },
  };
}

// ─── Listing & deletion ─────────────────────────────────────────────────────

export async function listFiles(
  bucket: 'uploads' | 'print-files',
  prefix: string,
): Promise<string[]> {
  const flatPrefix = flattenToFilename(bucket, prefix);
  const found = await listShopifyFilesByPrefix(flatPrefix);
  return found.map((f) => f.filename).filter((n) => n.length > 0);
}

export async function deleteFile(
  bucket: 'uploads' | 'print-files',
  key: string,
): Promise<void> {
  let found = await findShopifyFileByFilename(key);
  if (!found && key.includes('/')) {
    found = await findShopifyFileByFilename(flattenToFilename(bucket, key));
  }
  if (!found) return;
  await deleteShopifyFileById(found.id);
}

// ─── Generic buffer upload ──────────────────────────────────────────────────

export async function uploadBuffer(
  bucket: 'uploads' | 'print-files',
  key: string,
  buffer: Buffer,
  contentType: string,
): Promise<{ key: string; publicUrl: string }> {
  const filename = key.includes('/') ? flattenToFilename(bucket, key) : key;
  if (!FILENAME_SAFE.test(filename)) {
    throw new Error(
      `[storage] uploadBuffer: derived filename '${filename}' violates the safe-name pattern`,
    );
  }
  const result = await uploadShopifyFile(filename, contentType, buffer, {
    duplicateResolutionMode: 'REPLACE',
  });
  return { key: result.filename, publicUrl: result.url };
}

// ─── JSON helpers (deferred — used only by admin product CRUD) ──────────────

export async function putJsonObject<T>(
  bucket: 'uploads' | 'print-files',
  key: string,
  data: T,
): Promise<void> {
  const filename = key.includes('/') ? flattenToFilename(bucket, key) : key;
  await uploadShopifyFile(
    filename,
    'application/json',
    Buffer.from(JSON.stringify(data), 'utf8'),
    { contentType: 'FILE', duplicateResolutionMode: 'REPLACE' },
  );
}

export async function getJsonObject<T>(
  bucket: 'uploads' | 'print-files',
  key: string,
): Promise<T | null> {
  try {
    const obj = await getObject(bucket, key);
    const text = await obj.Body.transformToString();
    if (!text) return null;
    return JSON.parse(text) as T;
  } catch (err) {
    const name = err && typeof err === 'object' && 'name' in err
      ? (err as { name?: unknown }).name
      : null;
    if (name === 'NoSuchKey') return null;
    throw err;
  }
}

// ─── Copy ───────────────────────────────────────────────────────────────────

export async function copyObject(
  bucket: 'uploads' | 'print-files',
  sourceKey: string,
  destKey: string,
): Promise<void> {
  const obj = await getObject(bucket, sourceKey);
  const bytes = await obj.Body.transformToByteArray();
  await uploadBuffer(
    bucket,
    destKey,
    Buffer.from(bytes),
    'application/octet-stream',
  );
}

export type { ShopifyUploadResult };
