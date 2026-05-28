/**
 * Durability contract for the cart-composite blob cache.
 *
 * Background: cart items persist via Zustand-persist + Shopify cart
 * cookie indefinitely. Their `previewUrl` may resolve to
 * `/api/cart-composite/blob/{id}` when Shopify Files is unreachable
 * (dev fallback). The previous in-memory implementation evicted on
 * dev-server restart, so cart items added before a restart 404'd on
 * their thumbnail and the UI fell back to the placeholder grid icon.
 *
 * These tests pin the durability contract: a put-then-process-restart
 * scenario (simulated by re-reading from a fresh module require — the
 * cache itself reads from the filesystem each `get`, so the same module
 * already exercises the post-restart path) returns the same bytes.
 *
 * UAT-3 Phase 4 (Codex audit): the module now uses `/tmp` in production
 * and permits `CART_COMPOSITE_CACHE_DIR` only outside production. We set
 * the env to a test-specific tmp directory via `vi.hoisted` BEFORE the
 * module import, so the assertion target stays in sync with what the
 * module actually uses.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

// Hoisted: runs before the module imports below pick up
// `CART_COMPOSITE_CACHE_DIR`. Uses inline `require` because import
// statements are hoisted ABOVE this callback's binding.
const { TEST_CACHE_DIR } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const os = require('node:os') as typeof import('node:os');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const p = require('node:path') as typeof import('node:path');
  const dir = p.join(
    os.tmpdir(),
    `mosaiko-cart-composite-cache-test-${process.pid}`,
  );
  process.env.CART_COMPOSITE_CACHE_DIR = dir;
  return { TEST_CACHE_DIR: dir };
});

import {
  put,
  get,
  size,
  BLOB_ID_PATTERN,
  __clear,
} from '@/lib/cart-composite-blob-cache';

const CACHE_DIR = TEST_CACHE_DIR;
// Sanity: ensure the resolved dir is under tmpdir() and not the repo root.
if (!CACHE_DIR.startsWith(tmpdir())) {
  throw new Error(
    `Test cache dir resolved outside tmpdir(): ${CACHE_DIR}. ` +
      `The env override path is misconfigured.`,
  );
}

beforeEach(() => {
  // Ensure clean slate. Tests cohabit with a real dev cache; clear and
  // restore via __clear which deletes only entries — not the directory.
  if (existsSync(CACHE_DIR)) {
    rmSync(CACHE_DIR, { recursive: true, force: true });
  }
  mkdirSync(CACHE_DIR, { recursive: true });
});

afterEach(() => {
  __clear();
});

describe('cart-composite-blob-cache — durability', () => {
  test('put then get returns the same bytes', () => {
    const id = 'durability-test.png';
    const buffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]); // PNG header
    put(id, buffer, 'image/png');
    const out = get(id);
    expect(out).not.toBeNull();
    expect(out!.buffer.equals(buffer)).toBe(true);
    expect(out!.mime).toBe('image/png');
  });

  test('content survives a simulated process restart', async () => {
    // Write via the current module instance (mimics request handler).
    const id = 'survives-restart.jpg';
    const buffer = Buffer.from('fake-jpeg-bytes', 'utf8');
    put(id, buffer, 'image/jpeg');

    // Re-import the module fresh — equivalent to a new dev-server
    // process picking up the on-disk cache. vi.resetModules() ensures a
    // fresh module-graph instance with no carried-over state.
    vi.resetModules();
    const fresh = await import('@/lib/cart-composite-blob-cache');

    const out = fresh.get(id);
    expect(out).not.toBeNull();
    expect(out!.buffer.equals(buffer)).toBe(true);
    expect(out!.mime).toBe('image/jpeg');
  });

  test('size reflects on-disk entry count, not .mime sidecars', () => {
    expect(size()).toBe(0);
    put('a.png', Buffer.from('a'), 'image/png');
    put('b.png', Buffer.from('bb'), 'image/png');
    put('c.png', Buffer.from('ccc'), 'image/png');
    expect(size()).toBe(3); // not 6 (would-be wrong if it counted sidecars)
  });

  test('overwrite of existing id replaces buffer + mime', () => {
    const id = 'overwrite.png';
    put(id, Buffer.from('first'), 'image/png');
    put(id, Buffer.from('second'), 'image/jpeg');
    const out = get(id);
    expect(out!.buffer.toString()).toBe('second');
    expect(out!.mime).toBe('image/jpeg');
  });
});

describe('cart-composite-blob-cache — id validation', () => {
  test('valid ids match the documented pattern', () => {
    const valid = [
      'abc.png',
      'job_abc-123.jpg',
      'foo.bar.baz.png',
      'A1b2C3-_.png',
    ];
    for (const id of valid) {
      expect(BLOB_ID_PATTERN.test(id)).toBe(true);
      // Round-trip through put/get to confirm the id is accepted at
      // both write- and read-time.
      put(id, Buffer.from('x'), 'image/png');
      expect(get(id)).not.toBeNull();
    }
  });

  test('path traversal attempts are rejected at the regex layer', () => {
    const malicious = [
      '../escape.png',
      'sub/dir.png',
      'foo/../bar.png',
      './a.png',
      'a\\b.png',
      '',
    ];
    for (const id of malicious) {
      expect(BLOB_ID_PATTERN.test(id)).toBe(false);
      // `put` throws on invalid id; `get` returns null. Both refuse to
      // touch the filesystem with a non-canonical id — defense in depth
      // against a future caller forwarding user-derived data into the
      // id parameter.
      expect(() => put(id, Buffer.from('x'), 'image/png')).toThrow();
      expect(get(id)).toBeNull();
    }
  });

  test('"." and ".." pass the regex but are rejected by path-containment guard', () => {
    // BLOB_ID_PATTERN allows `.` and `..` because `\w.-` accepts both.
    // This test pins Codex's audit MAJOR finding: the cache's
    // safeResolve guard refuses any id whose canonical target isn't a
    // direct child of CACHE_DIR. Without this, `path.join(CACHE_DIR,
    // '..')` would resolve to the project root and writeFileSync would
    // create stray files outside the cache dir.
    for (const id of ['.', '..']) {
      expect(BLOB_ID_PATTERN.test(id)).toBe(true);
      expect(() => put(id, Buffer.from('x'), 'image/png')).toThrow(
        /escapes cache dir/i,
      );
      expect(get(id)).toBeNull();
    }
  });

  test('over-long ids are rejected', () => {
    const tooLong = 'a'.repeat(257) + '.png'; // 261 chars > 256 cap
    expect(BLOB_ID_PATTERN.test(tooLong)).toBe(false);
    expect(() => put(tooLong, Buffer.from('x'), 'image/png')).toThrow();
  });
});

describe('cart-composite-blob-cache — missing entries', () => {
  test('get of nonexistent id returns null without throwing', () => {
    expect(get('nonexistent.png')).toBeNull();
  });

  test('get returns null when the cache dir does not exist yet', () => {
    // Remove the dir entirely (beforeEach recreates it; remove again here).
    rmSync(CACHE_DIR, { recursive: true, force: true });
    expect(get('whatever.png')).toBeNull();
    expect(size()).toBe(0);
  });
});
