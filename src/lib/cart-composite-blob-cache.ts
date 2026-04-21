/**
 * In-memory blob cache for the cart-composite fallback path. Only used when
 * R2 is unreachable (typically local dev with placeholder creds). Instead of
 * returning the composite + thumb as base64 data URLs — which would overflow
 * the client's localStorage once persisted by the Zustand cart store — we
 * stash the buffers here and hand the client short URLs that resolve via
 * /api/cart-composite/blob/[id].
 *
 * Scope: per-process memory. Buffers vanish on dev server restart; the cart
 * item in localStorage still holds the URL and will 404 for its thumbnail,
 * which is acceptable because the order webhook regenerates everything from
 * the original photo anyway.
 */

const MAX_ENTRIES = 200;
export const DEFAULT_TTL_MS = 30 * 60 * 1000;

export const BLOB_ID_PATTERN = /^[\w.-]{1,256}$/;

interface Entry {
  buffer: Buffer;
  mime: string;
  expiresAt: number;
}

const store: Map<string, Entry> = new Map();

function sweepExpired(now: number): void {
  for (const [id, entry] of store) {
    if (entry.expiresAt <= now) {
      store.delete(id);
    }
  }
}

export function put(id: string, buffer: Buffer, mime: string, ttlMs: number = DEFAULT_TTL_MS): void {
  if (!BLOB_ID_PATTERN.test(id)) {
    throw new Error(`cart-composite-blob-cache: invalid id "${id}"`);
  }
  const now = Date.now();
  sweepExpired(now);

  // Overwrite keeps Map insertion order predictable; delete first so a
  // refreshed entry moves to the tail for oldest-first eviction.
  store.delete(id);

  while (store.size >= MAX_ENTRIES) {
    const oldest = store.keys().next().value;
    if (oldest === undefined) break;
    store.delete(oldest);
  }

  store.set(id, { buffer, mime, expiresAt: now + ttlMs });
}

export function get(id: string): { buffer: Buffer; mime: string } | null {
  if (!BLOB_ID_PATTERN.test(id)) return null;
  const now = Date.now();
  sweepExpired(now);
  const entry = store.get(id);
  if (!entry) return null;
  return { buffer: entry.buffer, mime: entry.mime };
}

export function size(): number {
  return store.size;
}
