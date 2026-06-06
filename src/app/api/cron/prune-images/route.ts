import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { pruneImages, type PruneDeps } from '@/lib/maintenance/prune-images';
import {
  deleteFilesBatch,
  listOldestShopifyFilesByPrefix,
} from '@/lib/shopify/files';
import { getImageRetentionDays } from '@/lib/site-content';
import { isAdminConfigured } from '@/lib/shopify/client';

export const dynamic = 'force-dynamic';

function timingSafeEqualStr(a: string, b: string): boolean {
  const aBuffer = Buffer.from(a, 'utf8');
  const bBuffer = Buffer.from(b, 'utf8');

  if (aBuffer.length !== bBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(aBuffer, bBuffer);
}

function unauthorized() {
  return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export async function GET(request: Request) {
  const authorization = request.headers.get('authorization') ?? '';
  const cronSecret = process.env.CRON_SECRET;
  const expected = `Bearer ${cronSecret ?? ''}`;

  if (!cronSecret || !timingSafeEqualStr(authorization, expected)) {
    return unauthorized();
  }

  try {
    const dryRun =
      new URL(request.url).searchParams.get('dryRun') === '1' ||
      process.env.PRUNE_DRY_RUN === '1';

    if (!isAdminConfigured()) {
      return NextResponse.json({ skipped: 'admin_not_configured' });
    }

    const deps: PruneDeps = {
      listOldest: (prefix, opts) =>
        listOldestShopifyFilesByPrefix(prefix, opts),
      deleteBatch: deleteFilesBatch,
      getRetentionDays: getImageRetentionDays,
      now: () => Date.now(),
      log: console,
    };

    const report = await pruneImages(deps, { dryRun });
    console.log('[cron/prune-images]', JSON.stringify(report));
    return NextResponse.json(report);
  } catch (error) {
    const message = messageOf(error);
    console.error('[cron/prune-images] failed', error);
    return NextResponse.json(
      { error: 'prune_failed', message },
      { status: 500 },
    );
  }
}
