/**
 * Filesystem-backed blob cache for the cart-composite fallback path. Only
 * used when R2 is unreachable (typically local dev with placeholder creds).
 * Instead of returning the composite + thumb as base64 data URLs — which
 * would overflow the client's localStorage once persisted by the Zustand
 * cart store — we stash the buffers on disk and hand the client short
 * URLs that resolve via /api/cart-composite/blob/[id].
 *
 * Why on disk, not in memory:
 *   The cart persists across dev-server restarts (Zustand-persist on
 *   localStorage + Shopify cart cookie). An in-memory `Map` evicts every
 *   entry on restart, so cart items added before a restart 404 on their
 *   thumbnail and the UI falls back to the placeholder grid icon. By
 *   writing to a project-local directory (`.cart-composite-cache/`) we
 *   match the cart's durability profile in dev.
 *
 * Storage location: `.cart-composite-cache/` at the project root. Outside
 * `.next/` so Turbopack's cache invalidation doesn't wipe entries on
 * config edits. Project-local so it doesn't leak across users; gitignored.
 *
 * Production: never reaches this code in the happy path. R2 holds the
 * canonical composite + thumb at permanent URLs and `/api/cart-composite`
 * returns those.
 */

import path from 'node:path';
import {
  mkdirSync,
  writeFileSync,
  renameSync,
  readFileSync,
  readdirSync,
  statSync,
  unlinkSync,
} from 'node:fs';

// Cap kept high — filesystem can hold thousands of small images without
// any practical concern. The eviction below is a soft ceiling so a runaway
// dev session doesn't fill disk indefinitely.
const MAX_ENTRIES = 1000;
// Exported for compat with existing callers that expect a TTL constant in
// the module surface. The cache itself no longer enforces TTL — cart items
// can outlive any reasonable TTL, and producing a stale-but-correct
// preview is preferable to producing a broken one.
export const DEFAULT_TTL_MS = 30 * 60 * 1000;

export const BLOB_ID_PATTERN = /^[\w.-]{1,256}$/;

// Module-level constant resolved once. process.cwd() is stable on the
// Next dev server (it's the project root); each route invocation uses
// the same dir.
const CACHE_DIR = path.join(process.cwd(), '.cart-composite-cache');

function ensureDir(): void {
  mkdirSync(CACHE_DIR, { recursive: true });
}

/**
 * Defense-in-depth path-containment check. Even though BLOB_ID_PATTERN
 * forbids slashes, the regex DOES accept `.` and `..` (since `\w.-`
 * passes both), and `path.join(CACHE_DIR, '..')` would resolve OUTSIDE
 * the cache dir. This guard rejects any id whose resolved target
 * doesn't sit strictly inside `CACHE_DIR/<single-segment>`.
 *
 * Returns the canonical absolute path or null if the id escapes.
 */
function safeResolve(id: string): string | null {
  const cacheRoot = path.resolve(CACHE_DIR);
  const candidate = path.resolve(cacheRoot, id);
  // Must be an immediate child of CACHE_DIR (no nested dirs, no escapes).
  if (path.dirname(candidate) !== cacheRoot) return null;
  return candidate;
}

function blobPath(id: string): string | null {
  return safeResolve(id);
}

function mimePath(id: string): string | null {
  return safeResolve(`${id}.mime`);
}

/**
 * Soft-cap eviction by mtime: when the cache exceeds MAX_ENTRIES, delete
 * the oldest blobs (and their .mime sidecars) until under the cap. This
 * is best-effort — a concurrent put during eviction is fine; the next
 * put will re-evaluate.
 */
function evictIfNeeded(): void {
  let entries: string[];
  try {
    entries = readdirSync(CACHE_DIR);
  } catch {
    return;
  }
  // Pair (id, mtimeMs) for blob files only (not .mime sidecars).
  const blobs: { id: string; mtime: number }[] = [];
  for (const name of entries) {
    if (name.endsWith('.mime')) continue;
    try {
      const m = statSync(path.join(CACHE_DIR, name));
      blobs.push({ id: name, mtime: m.mtimeMs });
    } catch {
      // file vanished mid-scan; ignore
    }
  }
  if (blobs.length <= MAX_ENTRIES) return;

  blobs.sort((a, b) => a.mtime - b.mtime); // oldest first
  const toRemove = blobs.length - MAX_ENTRIES;
  for (let i = 0; i < toRemove; i++) {
    const blobAbs = blobPath(blobs[i].id);
    const mimeAbs = mimePath(blobs[i].id);
    if (blobAbs) try { unlinkSync(blobAbs); } catch { /* ignore */ }
    if (mimeAbs) try { unlinkSync(mimeAbs); } catch { /* ignore */ }
  }
}

export function put(
  id: string,
  buffer: Buffer,
  mime: string,
  // ttlMs is accepted for API compatibility but ignored — the filesystem
  // entry stays until evicted by MAX_ENTRIES or the operator clears the
  // cache directory. See module-doc comment for rationale.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _ttlMs: number = DEFAULT_TTL_MS,
): void {
  if (!BLOB_ID_PATTERN.test(id)) {
    throw new Error(`cart-composite-blob-cache: invalid id "${id}"`);
  }
  // Defense-in-depth: BLOB_ID_PATTERN allows '.' and '..' which would
  // resolve outside CACHE_DIR via path.join. safeResolve rejects any
  // id whose canonical target isn't a direct child of CACHE_DIR.
  // Codex audit MAJOR fix.
  const target = blobPath(id);
  const mimeTarget = mimePath(id);
  if (!target || !mimeTarget) {
    throw new Error(`cart-composite-blob-cache: id escapes cache dir "${id}"`);
  }
  ensureDir();

  // Atomic write: tmp + rename. If the dev server crashes mid-write, the
  // partially-written .tmp file stays orphaned but the consumer never
  // sees a half-written blob.
  const tmp = `${target}.tmp`;
  writeFileSync(tmp, buffer);
  renameSync(tmp, target);

  // Sidecar holds the mime type so /api/cart-composite/blob/[id] can
  // serve the right Content-Type. One-line text — keep it minimal.
  writeFileSync(mimeTarget, mime, 'utf8');

  evictIfNeeded();
}

export function get(id: string): { buffer: Buffer; mime: string } | null {
  if (!BLOB_ID_PATTERN.test(id)) return null;
  const target = blobPath(id);
  const mimeTarget = mimePath(id);
  if (!target || !mimeTarget) return null;
  let buffer: Buffer;
  try {
    buffer = readFileSync(target);
  } catch {
    return null;
  }
  let mime = 'application/octet-stream';
  try {
    mime = readFileSync(mimeTarget, 'utf8').trim() || mime;
  } catch {
    // Older entries from before sidecar existed — fall through with the
    // octet-stream default. /api/cart-composite/blob/[id] is forgiving.
  }
  return { buffer, mime };
}

export function size(): number {
  try {
    return readdirSync(CACHE_DIR).filter((n) => !n.endsWith('.mime')).length;
  } catch {
    return 0;
  }
}

/**
 * Test-only utility: clears every entry in the cache dir. Production code
 * never calls this; it exists so vitest can isolate test runs.
 */
export function __clear(): void {
  let entries: string[];
  try {
    entries = readdirSync(CACHE_DIR);
  } catch {
    return;
  }
  for (const name of entries) {
    try {
      unlinkSync(path.join(CACHE_DIR, name));
    } catch { /* ignore */ }
  }
}
