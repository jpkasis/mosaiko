import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { PruneDeps, PruneReport } from '@/lib/maintenance/prune-images';

const mockPruneImages = vi.fn();
vi.mock('@/lib/maintenance/prune-images', () => ({
  pruneImages: (...args: unknown[]) => mockPruneImages(...args),
}));

const mockListOldestShopifyFilesByPrefix = vi.fn();
const mockDeleteFilesBatch = vi.fn();
vi.mock('@/lib/shopify/files', () => ({
  listOldestShopifyFilesByPrefix: (...args: unknown[]) =>
    mockListOldestShopifyFilesByPrefix(...args),
  deleteFilesBatch: (...args: unknown[]) => mockDeleteFilesBatch(...args),
}));

const mockGetImageRetentionDays = vi.fn();
vi.mock('@/lib/site-content', () => ({
  getImageRetentionDays: (...args: unknown[]) =>
    mockGetImageRetentionDays(...args),
}));

const mockIsAdminConfigured = vi.fn();
vi.mock('@/lib/shopify/client', () => ({
  isAdminConfigured: () => mockIsAdminConfigured(),
}));

const SECRET = 'test-cron-secret';
const REPORT: PruneReport = {
  retentionDays: 45,
  cutoffIso: '2026-04-22T12:00:00.000Z',
  disabled: false,
  perPrefix: {},
  totalDeleted: 3,
  capped: false,
  throttled: false,
  dryRun: false,
};

function cronReq(
  opts: { authorization?: string; url?: string } = {},
): NextRequest {
  return new NextRequest(
    opts.url ?? 'http://localhost/api/cron/prune-images',
    {
      headers:
        opts.authorization === undefined
          ? undefined
          : { Authorization: opts.authorization },
    },
  );
}

async function loadRoute() {
  return import('@/app/api/cron/prune-images/route');
}

let consoleLogSpy: ReturnType<typeof vi.spyOn>;
let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();

  mockPruneImages.mockReset();
  mockListOldestShopifyFilesByPrefix.mockReset();
  mockDeleteFilesBatch.mockReset();
  mockGetImageRetentionDays.mockReset();
  mockIsAdminConfigured.mockReset();

  mockPruneImages.mockResolvedValue(REPORT);
  mockListOldestShopifyFilesByPrefix.mockResolvedValue({
    items: [],
    endCursor: null,
    hasNextPage: false,
  });
  mockDeleteFilesBatch.mockResolvedValue({ deletedIds: [], failed: [] });
  mockGetImageRetentionDays.mockResolvedValue(45);
  mockIsAdminConfigured.mockReturnValue(true);

  vi.stubEnv('CRON_SECRET', SECRET);
  vi.stubEnv('PRUNE_DRY_RUN', '');

  consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  consoleErrorSpy = vi
    .spyOn(console, 'error')
    .mockImplementation(() => undefined);
});

afterEach(() => {
  consoleLogSpy.mockRestore();
  consoleErrorSpy.mockRestore();
  vi.unstubAllEnvs();
});

describe('GET /api/cron/prune-images', () => {
  test('401 when no Authorization header', async () => {
    const { GET } = await loadRoute();

    const res = await GET(cronReq());

    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: 'unauthorized' });
    expect(mockPruneImages).not.toHaveBeenCalled();
  });

  test('401 when wrong bearer token', async () => {
    const { GET } = await loadRoute();

    const res = await GET(cronReq({ authorization: 'Bearer wrong' }));

    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: 'unauthorized' });
    expect(mockPruneImages).not.toHaveBeenCalled();
  });

  test('401 when CRON_SECRET is unset even if a bearer is supplied', async () => {
    vi.stubEnv('CRON_SECRET', undefined);
    const { GET } = await loadRoute();

    const res = await GET(cronReq({ authorization: `Bearer ${SECRET}` }));

    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: 'unauthorized' });
    expect(mockPruneImages).not.toHaveBeenCalled();
  });

  test('200 and returns the report when Authorization bearer matches', async () => {
    const { GET } = await loadRoute();

    const res = await GET(cronReq({ authorization: `Bearer ${SECRET}` }));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual(REPORT);
    expect(mockPruneImages).toHaveBeenCalledTimes(1);
    expect(mockPruneImages).toHaveBeenCalledWith(expect.any(Object), {
      dryRun: false,
    });

    const deps = mockPruneImages.mock.calls[0][0] as PruneDeps;
    await deps.listOldest('mosaiko-original-', { first: 10, after: null });
    await deps.deleteBatch(['gid://shopify/MediaImage/1']);
    await deps.getRetentionDays();

    expect(mockListOldestShopifyFilesByPrefix).toHaveBeenCalledWith(
      'mosaiko-original-',
      { first: 10, after: null },
    );
    expect(mockDeleteFilesBatch).toHaveBeenCalledWith([
      'gid://shopify/MediaImage/1',
    ]);
    expect(mockGetImageRetentionDays).toHaveBeenCalledTimes(1);
    expect(typeof deps.now()).toBe('number');
    expect(deps.log).toBe(console);
  });

  test('forwards dryRun true from query string', async () => {
    const { GET } = await loadRoute();

    const res = await GET(
      cronReq({
        authorization: `Bearer ${SECRET}`,
        url: 'http://localhost/api/cron/prune-images?dryRun=1',
      }),
    );

    expect(res.status).toBe(200);
    expect(mockPruneImages).toHaveBeenCalledWith(expect.any(Object), {
      dryRun: true,
    });
  });

  test('forwards dryRun false without query string', async () => {
    const { GET } = await loadRoute();

    const res = await GET(cronReq({ authorization: `Bearer ${SECRET}` }));

    expect(res.status).toBe(200);
    expect(mockPruneImages).toHaveBeenCalledWith(expect.any(Object), {
      dryRun: false,
    });
  });

  test('200 skipped when Shopify Admin is not configured', async () => {
    mockIsAdminConfigured.mockReturnValue(false);
    const { GET } = await loadRoute();

    const res = await GET(cronReq({ authorization: `Bearer ${SECRET}` }));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      skipped: 'admin_not_configured',
    });
    expect(mockPruneImages).not.toHaveBeenCalled();
  });
});
