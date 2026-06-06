/*
 * Deliberately narrow prune scope:
 *
 * - These prefixes cover the live production image bulk: webhook print tiles
 *   from jobIds shaped `order-<orderId>-item-<lineItemId>`, customer
 *   originals, and cart composites.
 * - `/api/generate-print` can mint standalone tiles such as
 *   `mosaiko-<uuid>-tile-*` under non-`order-` jobIds, but that endpoint is
 *   not wired into the live client/checkout flow and has no caller, so it does
 *   not produce production files. It is intentionally out of scope here.
 * - Do not broaden this to `mosaiko-*`: that would catch admin/product-store
 *   state such as `mosaiko-uploads--catalog.json`, product images, and
 *   non-composite `mosaiko-print-files--*` deferred admin objects that must
 *   never be age-deleted.
 */
export const PRUNE_PREFIXES = [
  'mosaiko-original-',
  'mosaiko-order-',
  'mosaiko-print-files--cart-composites-',
] as const;

export const MAX_DELETIONS_PER_RUN = Number(
  process.env.PRUNE_MAX_DELETIONS ?? 1000,
);

const DAY_MS = 86_400_000;
const LIST_PAGE_SIZE = 250;
const DELETE_BATCH_SIZE = 20;
const MAX_RETENTION_DAYS = 36_500; // 100 years
const MAX_PAGES_PER_PREFIX = 10_000;
const ISO_DATETIME_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

type ListedFile = {
  id: string;
  createdAt: string | null;
  filename: string;
};

type ListResult = {
  items: ListedFile[];
  endCursor: string | null;
  hasNextPage: boolean;
};

type DeleteResult = {
  deletedIds: string[];
  failed: Array<{ id: string; message: string }>;
};

export interface PruneDeps {
  listOldest: (
    prefix: string,
    opts: { first: number; after: string | null },
  ) => Promise<ListResult>;
  deleteBatch: (ids: string[]) => Promise<DeleteResult>;
  getRetentionDays: () => Promise<number>;
  now: () => number;
  log: Pick<Console, 'log' | 'warn' | 'error'>;
}

export interface PruneReport {
  retentionDays: number;
  cutoffIso: string | null;
  disabled: boolean;
  perPrefix: Record<
    string,
    { scanned: number; deleted: number; skippedUnknownAge: number }
  >;
  totalDeleted: number;
  capped: boolean;
  throttled: boolean;
  dryRun: boolean;
  error?: string;
}

type QueuedDelete = { id: string; prefix: string };

function initialPerPrefix(): PruneReport['perPrefix'] {
  return Object.fromEntries(
    PRUNE_PREFIXES.map((prefix) => [
      prefix,
      { scanned: 0, deleted: 0, skippedUnknownAge: 0 },
    ]),
  );
}

function createReport(
  retentionDays: number,
  cutoffIso: string | null,
  disabled: boolean,
  dryRun: boolean,
): PruneReport {
  return {
    retentionDays,
    cutoffIso,
    disabled,
    perPrefix: initialPerPrefix(),
    totalDeleted: 0,
    capped: false,
    throttled: false,
    dryRun,
  };
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  if (month === 4 || month === 6 || month === 9 || month === 11) return 30;
  return 31;
}

function parseKnownCreatedAtMs(createdAt: string | null): number | null {
  const match = createdAt ? ISO_DATETIME_PATTERN.exec(createdAt) : null;
  if (!match) return null;

  const [, yearText, monthText, dayText, hourText, minuteText, secondText] =
    match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);

  if (month < 1 || month > 12) return null;

  const maxDay = daysInMonth(year, month);
  if (
    day < 1 ||
    day > maxDay ||
    hour > 23 ||
    minute > 59 ||
    second > 60
  ) {
    return null;
  }

  // match[0] is the full anchored match (=== createdAt when matched); using it
  // keeps the type as `string` so the build's typecheck passes.
  const parsed = Date.parse(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

export function isShopifyThrottleError(error: unknown): boolean {
  return hasThrottleSignal(error);
}

function hasThrottleSignal(value: unknown, depth = 0): boolean {
  if (depth > 6 || value == null) return false;

  if (typeof value === 'string') {
    const upper = value.toUpperCase();
    return (
      upper.includes('THROTTLED') ||
      upper.includes('TOO MANY REQUESTS') ||
      upper.includes('HTTP 429')
    );
  }

  if (typeof value === 'number') return value === 429;

  if (value instanceof Error) {
    const record = value as Error & {
      cause?: unknown;
      code?: unknown;
      extensions?: unknown;
      errors?: unknown;
    };
    return (
      hasThrottleSignal(record.message, depth + 1) ||
      hasThrottleSignal(record.cause, depth + 1) ||
      hasThrottleSignal(record.code, depth + 1) ||
      hasThrottleSignal(record.extensions, depth + 1) ||
      hasThrottleSignal(record.errors, depth + 1)
    );
  }

  if (Array.isArray(value)) {
    return value.some((item) => hasThrottleSignal(item, depth + 1));
  }

  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return (
      hasThrottleSignal(record.code, depth + 1) ||
      hasThrottleSignal(record.status, depth + 1) ||
      hasThrottleSignal(record.extensions, depth + 1) ||
      hasThrottleSignal(record.errors, depth + 1) ||
      hasThrottleSignal(record.message, depth + 1)
    );
  }

  return false;
}

function deletionCap(): number {
  if (
    !Number.isFinite(MAX_DELETIONS_PER_RUN) ||
    MAX_DELETIONS_PER_RUN <= 0
  ) {
    return 0;
  }
  return Math.floor(MAX_DELETIONS_PER_RUN);
}

function countDeleted(
  report: PruneReport,
  prefixById: Map<string, string>,
  deletedIds: string[],
): void {
  for (const id of deletedIds) {
    const prefix = prefixById.get(id);
    if (prefix) {
      report.perPrefix[prefix].deleted += 1;
      report.totalDeleted += 1;
    }
    prefixById.delete(id);
  }
}

export async function pruneImages(
  deps: PruneDeps,
  opts: { dryRun?: boolean } = {},
): Promise<PruneReport> {
  const dryRun = opts.dryRun === true;

  let retentionDays: number;
  try {
    retentionDays = await deps.getRetentionDays();
  } catch (error) {
    const report = createReport(0, null, true, dryRun);
    report.error = messageOf(error);
    deps.log.error('[prune-images] failed to read image retention setting', {
      error: report.error,
    });
    return report;
  }

  if (
    !Number.isFinite(retentionDays) ||
    retentionDays < 0 ||
    retentionDays > MAX_RETENTION_DAYS
  ) {
    const report = createReport(retentionDays, null, true, dryRun);
    report.error = `Invalid retentionDays: ${retentionDays}`;
    deps.log.error('[prune-images] invalid image retention setting', {
      retentionDays,
      maxRetentionDays: MAX_RETENTION_DAYS,
    });
    return report;
  }

  if (retentionDays === 0) {
    return createReport(retentionDays, null, true, dryRun);
  }

  const cutoffMs = deps.now() - retentionDays * DAY_MS;
  const cutoffDate = new Date(cutoffMs);
  if (!Number.isFinite(cutoffDate.getTime())) {
    const report = createReport(retentionDays, null, true, dryRun);
    report.error = `Invalid cutoff date for retentionDays: ${retentionDays}`;
    deps.log.error('[prune-images] invalid image retention cutoff', {
      retentionDays,
      cutoffMs,
    });
    return report;
  }

  const report = createReport(
    retentionDays,
    cutoffDate.toISOString(),
    false,
    dryRun,
  );
  const maxDeletions = deletionCap();
  if (maxDeletions === 0) {
    report.capped = true;
    deps.log.warn('[prune-images] deletion cap is zero; stopping sweep', {
      maxDeletions: MAX_DELETIONS_PER_RUN,
    });
    return report;
  }

  const pending: QueuedDelete[] = [];
  const prefixById = new Map<string, string>();
  let selectedForDeletion = 0;
  let stopSweep = false;

  const markUnexpectedStop = (phase: string, error: unknown) => {
    report.error = messageOf(error);
    deps.log.error(`[prune-images] ${phase} failed; stopping sweep`, {
      error: report.error,
    });
  };

  const markThrottleStop = (phase: string, error: unknown) => {
    report.throttled = true;
    deps.log.warn(`[prune-images] Shopify throttled during ${phase}; stopping sweep`, {
      error: messageOf(error),
    });
  };

  const flushPending = async (): Promise<boolean> => {
    while (pending.length > 0) {
      const batch = pending.splice(0, DELETE_BATCH_SIZE);
      const ids = batch.map((item) => item.id);

      if (dryRun) {
        countDeleted(report, prefixById, ids);
        continue;
      }

      let result: DeleteResult;
      try {
        result = await deps.deleteBatch(ids);
      } catch (error) {
        if (isShopifyThrottleError(error)) {
          markThrottleStop('delete', error);
        } else {
          markUnexpectedStop('delete', error);
        }
        return false;
      }

      countDeleted(report, prefixById, result.deletedIds);
      for (const failure of result.failed) {
        deps.log.warn('[prune-images] Shopify file delete failed', failure);
      }
      for (const id of ids) {
        prefixById.delete(id);
      }
    }
    return true;
  };

  const enqueueDelete = async (
    prefix: string,
    id: string,
    unscannedInPage: number,
    hasNextPage: boolean,
  ): Promise<boolean> => {
    selectedForDeletion += 1;
    prefixById.set(id, prefix);
    pending.push({ id, prefix });

    if (pending.length >= DELETE_BATCH_SIZE) {
      const ok = await flushPending();
      if (!ok) return false;
    }

    if (selectedForDeletion >= maxDeletions) {
      report.capped = true;
      deps.log.warn('[prune-images] deletion cap reached; stopping sweep', {
        maxDeletions,
        selectedForDeletion,
        prefix,
        unscannedInCurrentPage: unscannedInPage,
        laterPagesUnscanned: hasNextPage,
      });
      return false;
    }

    return true;
  };

  for (const prefix of PRUNE_PREFIXES) {
    let after: string | null = null;
    let pagesFetched = 0;
    let stopPrefix = false;

    while (!stopPrefix && !stopSweep) {
      if (pagesFetched >= MAX_PAGES_PER_PREFIX) {
        report.error = `Shopify files pagination exceeded ${MAX_PAGES_PER_PREFIX} pages for prefix ${prefix}`;
        deps.log.error('[prune-images] stopping sweep after pagination page cap', {
          prefix,
          maxPagesPerPrefix: MAX_PAGES_PER_PREFIX,
          after,
        });
        stopSweep = true;
        break;
      }

      const cursorUsed: string | null = after;
      let page: ListResult;
      try {
        page = await deps.listOldest(prefix, {
          first: LIST_PAGE_SIZE,
          after: cursorUsed,
        });
        pagesFetched += 1;
      } catch (error) {
        if (isShopifyThrottleError(error)) {
          markThrottleStop('list', error);
        } else {
          markUnexpectedStop('list', error);
        }
        stopSweep = true;
        break;
      }

      for (let i = 0; i < page.items.length; i += 1) {
        const item = page.items[i];
        report.perPrefix[prefix].scanned += 1;

        const createdAtMs = parseKnownCreatedAtMs(item.createdAt);
        if (createdAtMs === null) {
          report.perPrefix[prefix].skippedUnknownAge += 1;
          continue;
        }

        if (createdAtMs >= cutoffMs) {
          stopPrefix = true;
          break;
        }

        const ok = await enqueueDelete(
          prefix,
          item.id,
          page.items.length - i - 1,
          page.hasNextPage,
        );
        if (!ok) {
          stopSweep = true;
          break;
        }
      }

      if (stopSweep || stopPrefix) break;

      const flushed = await flushPending();
      if (!flushed) {
        stopSweep = true;
        break;
      }

      if (!page.hasNextPage) break;
      if (!page.endCursor) {
        report.error = 'Shopify files page hasNextPage=true without endCursor';
        deps.log.error('[prune-images] stopping to avoid pagination loop', {
          prefix,
          after: cursorUsed,
        });
        stopSweep = true;
        break;
      }
      if (page.endCursor === cursorUsed) {
        report.error = 'Shopify files pagination cursor did not advance';
        deps.log.error('[prune-images] stopping to avoid pagination loop', {
          prefix,
          after: cursorUsed,
          endCursor: page.endCursor,
          pagesFetched,
        });
        stopSweep = true;
        break;
      }
      after = page.endCursor;
    }

    if (!report.throttled && !report.error) {
      const flushed = await flushPending();
      if (!flushed) break;
    }
    if (stopSweep) break;
  }

  return report;
}
