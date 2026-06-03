/**
 * UAT-6 PR4 contract test: admin password hash resolution.
 *
 * Precedence: Shopify metafield (in-app override) > env (bootstrap).
 * Fail-closed: Shopify read error throws rather than silently using the
 * (possibly rotated-away) env hash.
 */
import { describe, test, expect, vi, beforeEach } from 'vitest';
import bcrypt from 'bcryptjs';

const mockGetShopMetafield = vi.fn();
vi.mock('@/lib/shopify/queries/shop', () => ({
  getShopMetafield: (ns: string, key: string) => mockGetShopMetafield(ns, key),
}));

const ENV_PASSWORD = 'env-password';
const METAFIELD_PASSWORD = 'metafield-password';
const ENV_HASH = bcrypt.hashSync(ENV_PASSWORD, 4);
const METAFIELD_HASH = bcrypt.hashSync(METAFIELD_PASSWORD, 4);

beforeEach(() => {
  mockGetShopMetafield.mockReset();
  vi.resetModules();
  delete process.env.SHOPIFY_ADMIN_API_TOKEN;
  delete process.env.SHOPIFY_CLIENT_ID;
  delete process.env.SHOPIFY_CLIENT_SECRET;
  process.env.ADMIN_PASSWORD_HASH = ENV_HASH;
});

function withShopify() {
  process.env.SHOPIFY_ADMIN_API_TOKEN = 'shpat_test';
}

describe('getPasswordHash', () => {
  test('Shopify unavailable → env hash', async () => {
    const { getPasswordHash } = await import('@/lib/admin/auth');
    expect(await getPasswordHash()).toBe(ENV_HASH);
    expect(mockGetShopMetafield).not.toHaveBeenCalled();
  });

  test('metafield present + non-empty → metafield hash (override wins)', async () => {
    withShopify();
    mockGetShopMetafield.mockResolvedValue(METAFIELD_HASH);
    const { getPasswordHash } = await import('@/lib/admin/auth');
    expect(await getPasswordHash()).toBe(METAFIELD_HASH);
  });

  test('metafield absent → env hash (bootstrap)', async () => {
    withShopify();
    mockGetShopMetafield.mockResolvedValue(null);
    const { getPasswordHash } = await import('@/lib/admin/auth');
    expect(await getPasswordHash()).toBe(ENV_HASH);
  });

  test('metafield empty/whitespace → env hash', async () => {
    withShopify();
    mockGetShopMetafield.mockResolvedValue('   ');
    const { getPasswordHash } = await import('@/lib/admin/auth');
    expect(await getPasswordHash()).toBe(ENV_HASH);
  });

  test('Shopify read error → throws (fail closed)', async () => {
    withShopify();
    mockGetShopMetafield.mockRejectedValue(new Error('shopify down'));
    const { getPasswordHash } = await import('@/lib/admin/auth');
    await expect(getPasswordHash()).rejects.toThrow();
  });

  // Codex PR4 audit: the blocking TTL cache must NOT serve a stale value
  // when the refresh after expiry fails. Strict fail-closed.
  test('cached value present, TTL expired, Shopify throws → rejects (no stale serve)', async () => {
    vi.useFakeTimers();
    try {
      withShopify();
      // First read succeeds + caches.
      mockGetShopMetafield.mockResolvedValueOnce(METAFIELD_HASH);
      const { getPasswordHash } = await import('@/lib/admin/auth');
      expect(await getPasswordHash()).toBe(METAFIELD_HASH);

      // Advance past the 5-min TTL.
      vi.advanceTimersByTime(5 * 60 * 1000 + 1);

      // Refresh now fails → must reject, NOT serve the stale METAFIELD_HASH.
      mockGetShopMetafield.mockRejectedValue(new Error('shopify down'));
      await expect(getPasswordHash()).rejects.toThrow();
    } finally {
      vi.useRealTimers();
    }
  });

  test('within TTL, repeated calls hit cache (single Shopify read)', async () => {
    withShopify();
    mockGetShopMetafield.mockResolvedValue(METAFIELD_HASH);
    const { getPasswordHash } = await import('@/lib/admin/auth');
    await getPasswordHash();
    await getPasswordHash();
    await getPasswordHash();
    expect(mockGetShopMetafield).toHaveBeenCalledTimes(1);
  });
});

describe('verifyPassword', () => {
  test('uses metafield hash when override set', async () => {
    withShopify();
    mockGetShopMetafield.mockResolvedValue(METAFIELD_HASH);
    const { verifyPassword } = await import('@/lib/admin/auth');
    expect(await verifyPassword(METAFIELD_PASSWORD)).toBe(true);
    expect(await verifyPassword(ENV_PASSWORD)).toBe(false);
  });

  test('uses env hash when no override', async () => {
    const { verifyPassword } = await import('@/lib/admin/auth');
    expect(await verifyPassword(ENV_PASSWORD)).toBe(true);
    expect(await verifyPassword('wrong')).toBe(false);
  });
});
