/**
 * PR-B (Codex re-audit fix) — public live price map. The client
 * `PricesProvider` re-fetches this so the displayed price stays current after
 * the initial SSR snapshot (admin price edit / publish mid-session), keeping
 * displayed === charged. Cached the same as the storefront read.
 */
import { NextResponse } from 'next/server';
import { getDisplayPriceMap } from '@/lib/shopify/prices';

export async function GET(): Promise<NextResponse> {
  return NextResponse.json(await getDisplayPriceMap());
}
