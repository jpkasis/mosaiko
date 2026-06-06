import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { PruneDeps } from '@/lib/maintenance/prune-images';

type ListPage = Awaited<ReturnType<PruneDeps['listOldest']>>;

const NOW = Date.parse('2026-06-06T12:00:00.000Z');
const OLD = '2026-04-01T00:00:00.000Z';
const NEW = '2026-05-01T00:00:00.000Z';

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

function file(id: string, createdAt: string | null): ListPage['items'][number] {
  return { id, createdAt, filename: `${id}.png` };
}

function page(
  items: ListPage['items'],
  opts: { endCursor?: string | null; hasNextPage?: boolean } = {},
): ListPage {
  return {
    items,
    endCursor: opts.endCursor ?? null,
    hasNextPage: opts.hasNextPage ?? false,
  };
}

async function loadPrune(maxDeletions?: number) {
  if (maxDeletions !== undefined) {
    vi.stubEnv('PRUNE_MAX_DELETIONS', String(maxDeletions));
  }
  return import('@/lib/maintenance/prune-images');
}

function makeDeps() {
  const listOldest = vi.fn<PruneDeps['listOldest']>(async () => page([]));
  const deleteBatch = vi.fn(async (ids: string[]) => ({
    deletedIds: ids,
    failed: [] as Array<{ id: string; message: string }>,
  }));
  const getRetentionDays = vi.fn(async () => 45);
  const log = {
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  const deps: PruneDeps = {
    listOldest,
    deleteBatch,
    getRetentionDays,
    now: () => NOW,
    log,
  };
  return { deps, listOldest, deleteBatch, getRetentionDays, log };
}

function deletedIds(deleteBatch: ReturnType<typeof makeDeps>['deleteBatch']) {
  return deleteBatch.mock.calls.flatMap(([ids]) => ids);
}

describe('pruneImages', () => {
  test('computes cutoffIso from retentionDays and now', async () => {
    const { pruneImages } = await loadPrune();
    const { deps, listOldest } = makeDeps();
    listOldest.mockResolvedValue(page([file('new', NEW)]));

    const report = await pruneImages(deps);

    expect(report.retentionDays).toBe(45);
    expect(report.cutoffIso).toBe('2026-04-22T12:00:00.000Z');
    expect(report.disabled).toBe(false);
  });

  test('breaks ascending scans at the first new file and does not read later pages', async () => {
    const { pruneImages, PRUNE_PREFIXES } = await loadPrune();
    const { deps, listOldest, deleteBatch } = makeDeps();
    const firstPrefix = PRUNE_PREFIXES[0];

    listOldest.mockImplementation(async (prefix, opts) => {
      if (prefix === firstPrefix && opts.after === null) {
        return page(
          [
            file('old-1', OLD),
            file('old-2', OLD),
            file('new-1', NEW),
            file('trailing-old-unreachable', OLD),
          ],
          { endCursor: 'next-page', hasNextPage: true },
        );
      }
      if (prefix === firstPrefix && opts.after === 'next-page') {
        throw new Error('second page should not be listed');
      }
      return page([]);
    });

    const report = await pruneImages(deps);

    expect(report.perPrefix[firstPrefix].deleted).toBe(2);
    expect(deletedIds(deleteBatch)).toEqual(['old-1', 'old-2']);
    expect(deletedIds(deleteBatch)).not.toContain('new-1');
    expect(deletedIds(deleteBatch)).not.toContain('trailing-old-unreachable');
    expect(
      listOldest.mock.calls.some(
        ([prefix, opts]) => prefix === firstPrefix && opts.after === 'next-page',
      ),
    ).toBe(false);
  });

  test('honors the retention kill-switch without listing or deleting', async () => {
    const { pruneImages } = await loadPrune();
    const { deps, getRetentionDays, listOldest, deleteBatch } = makeDeps();
    getRetentionDays.mockResolvedValue(0);

    const report = await pruneImages(deps);

    expect(report.disabled).toBe(true);
    expect(report.cutoffIso).toBeNull();
    expect(report.totalDeleted).toBe(0);
    expect(listOldest).not.toHaveBeenCalled();
    expect(deleteBatch).not.toHaveBeenCalled();
  });

  test('rejects retentionDays above the maintenance maximum without listing or deleting', async () => {
    const { pruneImages } = await loadPrune();
    const { deps, getRetentionDays, listOldest, deleteBatch, log } = makeDeps();
    getRetentionDays.mockResolvedValue(10_000_000);

    const report = await pruneImages(deps);

    expect(report.disabled).toBe(true);
    expect(report.cutoffIso).toBeNull();
    expect(report.error).toBe('Invalid retentionDays: 10000000');
    expect(listOldest).not.toHaveBeenCalled();
    expect(deleteBatch).not.toHaveBeenCalled();
    expect(log.error).toHaveBeenCalled();
  });

  test('stops at the per-run deletion cap across prefix boundaries', async () => {
    const { pruneImages, PRUNE_PREFIXES } = await loadPrune(3);
    const { deps, listOldest, deleteBatch, log } = makeDeps();
    const firstPrefix = PRUNE_PREFIXES[0];
    const secondPrefix = PRUNE_PREFIXES[1];
    listOldest.mockImplementation(async (prefix) => {
      if (prefix === firstPrefix) {
        return page([file('p1-old-1', OLD), file('p1-old-2', OLD)]);
      }
      if (prefix === secondPrefix) {
        return page([
          file('p2-old-1', OLD),
          file('p2-old-2-unscanned', OLD),
        ]);
      }
      return page([file('p3-should-not-list', OLD)]);
    });

    const report = await pruneImages(deps);

    expect(report.capped).toBe(true);
    expect(report.totalDeleted).toBe(3);
    expect(report.perPrefix[firstPrefix].deleted).toBe(2);
    expect(report.perPrefix[secondPrefix].deleted).toBe(1);
    expect(
      report.perPrefix[firstPrefix].deleted +
        report.perPrefix[secondPrefix].deleted,
    ).toBe(3);
    expect(deletedIds(deleteBatch)).toEqual([
      'p1-old-1',
      'p1-old-2',
      'p2-old-1',
    ]);
    expect(listOldest.mock.calls.map(([prefix]) => prefix)).toEqual([
      firstPrefix,
      secondPrefix,
    ]);
    expect(log.warn).toHaveBeenCalled();
  });

  test('fails closed on unknown age and never deletes unknown-age nodes', async () => {
    const { pruneImages, PRUNE_PREFIXES } = await loadPrune();
    const { deps, listOldest, deleteBatch } = makeDeps();
    const firstPrefix = PRUNE_PREFIXES[0];
    listOldest.mockImplementation(async (prefix) => {
      if (prefix !== firstPrefix) return page([]);
      return page([
        file('null-age', null),
        file('bad-age', 'not-a-date'),
        file('zero-age', '0'),
        file('year-age', '2026'),
        file('empty-age', ''),
        file('date-only-age', '2026-04-01'),
        file('old-known', OLD),
        file('new-known', NEW),
      ]);
    });

    const report = await pruneImages(deps);

    expect(report.perPrefix[firstPrefix].skippedUnknownAge).toBe(6);
    expect(report.perPrefix[firstPrefix].deleted).toBe(1);
    expect(deletedIds(deleteBatch)).toEqual(['old-known']);
    expect(deletedIds(deleteBatch)).not.toContain('null-age');
    expect(deletedIds(deleteBatch)).not.toContain('bad-age');
    expect(deletedIds(deleteBatch)).not.toContain('zero-age');
    expect(deletedIds(deleteBatch)).not.toContain('year-age');
    expect(deletedIds(deleteBatch)).not.toContain('empty-age');
    expect(deletedIds(deleteBatch)).not.toContain('date-only-age');
  });

  test('fails closed on calendar-impossible createdAt values', async () => {
    const { pruneImages, PRUNE_PREFIXES } = await loadPrune();
    const { deps, listOldest, deleteBatch } = makeDeps();
    const firstPrefix = PRUNE_PREFIXES[0];
    listOldest.mockImplementation(async (prefix) => {
      if (prefix !== firstPrefix) return page([]);
      return page([
        file('bad-feb-overflow', '2026-02-31T00:00:00Z'),
        file('bad-month-high', '2026-13-01T00:00:00Z'),
        file('bad-month-zero', '2026-00-10T00:00:00Z'),
        file('bad-april-overflow', '2026-04-31T00:00:00Z'),
        file('bad-non-leap-day', '2026-02-29T00:00:00Z'),
        file('real-leap-day', '2024-02-29T00:00:00Z'),
        file('new-known', NEW),
      ]);
    });

    const report = await pruneImages(deps);

    expect(report.perPrefix[firstPrefix].skippedUnknownAge).toBe(5);
    expect(report.perPrefix[firstPrefix].deleted).toBe(1);
    expect(deletedIds(deleteBatch)).toEqual(['real-leap-day']);
    expect(deletedIds(deleteBatch)).not.toContain('bad-feb-overflow');
    expect(deletedIds(deleteBatch)).not.toContain('bad-month-high');
    expect(deletedIds(deleteBatch)).not.toContain('bad-month-zero');
    expect(deletedIds(deleteBatch)).not.toContain('bad-april-overflow');
    expect(deletedIds(deleteBatch)).not.toContain('bad-non-leap-day');
  });

  test('dryRun counts candidate deletes without calling deleteBatch', async () => {
    const { pruneImages, PRUNE_PREFIXES } = await loadPrune();
    const { deps, listOldest, deleteBatch } = makeDeps();
    const firstPrefix = PRUNE_PREFIXES[0];
    listOldest.mockImplementation(async (prefix) => {
      if (prefix !== firstPrefix) return page([]);
      return page([file('old-1', OLD), file('old-2', OLD), file('new-1', NEW)]);
    });

    const report = await pruneImages(deps, { dryRun: true });

    expect(report.dryRun).toBe(true);
    expect(report.totalDeleted).toBe(2);
    expect(report.perPrefix[firstPrefix].deleted).toBe(2);
    expect(deleteBatch).not.toHaveBeenCalled();
  });

  test('scans all three managed prefixes', async () => {
    const { pruneImages, PRUNE_PREFIXES } = await loadPrune();
    const { deps, listOldest } = makeDeps();

    await pruneImages(deps);

    const prefixes = listOldest.mock.calls.map(([prefix]) => prefix);
    for (const prefix of PRUNE_PREFIXES) {
      expect(prefixes).toContain(prefix);
    }
  });

  test('stops when Shopify pagination does not advance', async () => {
    const { pruneImages, PRUNE_PREFIXES } = await loadPrune();
    const { deps, listOldest, deleteBatch, log } = makeDeps();
    const firstPrefix = PRUNE_PREFIXES[0];
    listOldest.mockImplementation(async (prefix, opts) => {
      if (prefix !== firstPrefix) return page([]);
      return page([file(`unknown-${opts.after ?? 'first'}`, null)], {
        endCursor: 'stuck-cursor',
        hasNextPage: true,
      });
    });

    const report = await pruneImages(deps);

    expect(report.error).toBe('Shopify files pagination cursor did not advance');
    expect(report.perPrefix[firstPrefix].skippedUnknownAge).toBe(2);
    expect(
      listOldest.mock.calls.filter(([prefix]) => prefix === firstPrefix),
    ).toHaveLength(2);
    expect(deleteBatch).not.toHaveBeenCalled();
    expect(log.error).toHaveBeenCalledWith(
      '[prune-images] stopping to avoid pagination loop',
      expect.objectContaining({
        prefix: firstPrefix,
        after: 'stuck-cursor',
        endCursor: 'stuck-cursor',
      }),
    );
  });

  test('logs deleteBatch failures and continues', async () => {
    const { pruneImages, PRUNE_PREFIXES } = await loadPrune();
    const { deps, listOldest, deleteBatch, log } = makeDeps();
    const firstPrefix = PRUNE_PREFIXES[0];
    listOldest.mockImplementation(async (prefix) => {
      if (prefix !== firstPrefix) return page([]);
      return page([file('old-fails', OLD), file('new-1', NEW)]);
    });
    deleteBatch.mockResolvedValue({
      deletedIds: [],
      failed: [{ id: 'old-fails', message: 'Access denied' }],
    });

    const report = await pruneImages(deps);

    expect(report.totalDeleted).toBe(0);
    expect(log.warn).toHaveBeenCalledWith(
      '[prune-images] Shopify file delete failed',
      { id: 'old-fails', message: 'Access denied' },
    );
    const prefixes = listOldest.mock.calls.map(([prefix]) => prefix);
    for (const prefix of PRUNE_PREFIXES) {
      expect(prefixes).toContain(prefix);
    }
  });

  test('returns a throttled report for HTTP 429 list failures', async () => {
    const { pruneImages } = await loadPrune();
    const { deps, listOldest, deleteBatch, log } = makeDeps();
    const throttle = new Error('[Shopify Admin] HTTP 429: Too Many Requests');
    listOldest.mockRejectedValue(throttle);

    const report = await pruneImages(deps);

    expect(report.throttled).toBe(true);
    expect(report.error).toBeUndefined();
    expect(report.totalDeleted).toBe(0);
    expect(deleteBatch).not.toHaveBeenCalled();
    expect(log.warn).toHaveBeenCalled();
  });

  test('returns an errored report for unexpected list failures without throwing', async () => {
    const { pruneImages } = await loadPrune();
    const { deps, listOldest, deleteBatch, log } = makeDeps();
    listOldest.mockRejectedValue(new Error('unexpected list failure'));

    const report = await pruneImages(deps);

    expect(report.throttled).toBe(false);
    expect(report.error).toBe('unexpected list failure');
    expect(report.totalDeleted).toBe(0);
    expect(listOldest).toHaveBeenCalledTimes(1);
    expect(deleteBatch).not.toHaveBeenCalled();
    expect(log.error).toHaveBeenCalled();
  });

  test('stops without listing when deletion cap env is zero or NaN', async () => {
    for (const maxDeletions of [0, Number.NaN]) {
      vi.unstubAllEnvs();
      vi.resetModules();
      const { pruneImages } = await loadPrune(maxDeletions);
      const { deps, listOldest, deleteBatch, log } = makeDeps();

      const report = await pruneImages(deps);

      expect(report.capped).toBe(true);
      expect(report.totalDeleted).toBe(0);
      expect(listOldest).not.toHaveBeenCalled();
      expect(deleteBatch).not.toHaveBeenCalled();
      expect(log.warn).toHaveBeenCalledWith(
        '[prune-images] deletion cap is zero; stopping sweep',
        expect.objectContaining({ maxDeletions }),
      );
    }
  });

  test('stops gracefully when Shopify throttles during deleteBatch', async () => {
    const { pruneImages, PRUNE_PREFIXES } = await loadPrune();
    const { deps, listOldest, deleteBatch, log } = makeDeps();
    const firstPrefix = PRUNE_PREFIXES[0];
    listOldest.mockImplementation(async (prefix) => {
      if (prefix !== firstPrefix) return page([]);
      return page([file('old-1', OLD), file('new-1', NEW)]);
    });
    deleteBatch.mockRejectedValue(
      new Error('[Shopify Admin] GraphQL errors:\nTHROTTLED'),
    );

    const report = await pruneImages(deps);

    expect(report.throttled).toBe(true);
    expect(report.totalDeleted).toBe(0);
    expect(deleteBatch).toHaveBeenCalledTimes(1);
    expect(listOldest.mock.calls.map(([prefix]) => prefix)).toEqual([
      firstPrefix,
    ]);
    expect(log.warn).toHaveBeenCalled();
  });
});
