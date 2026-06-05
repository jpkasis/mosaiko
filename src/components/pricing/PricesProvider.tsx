'use client';

/**
 * PR-B — app-wide live price context. The `[locale]` layout fetches the
 * `(category, size) → price` map server-side (from Shopify, via
 * `getDisplayPriceMap`) and provides it here so every client price display
 * (catalog cards, builder grid/category selectors, add-to-cart) reads the
 * SAME number the checkout charges. Falls back to the legacy size-based
 * grid-config price when a value is missing (pre-migration / SSR safety),
 * so nothing ever shows a blank price.
 */
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { CategoryType } from '@/lib/customization-types';
import { CATEGORY_REGISTRY } from '@/lib/customization-types';
import type { GridSize } from '@/lib/grid-config';
import { GRID_CONFIGS } from '@/lib/grid-config';
import type { DisplayPriceMap } from '@/lib/shopify/prices';

const PricesContext = createContext<DisplayPriceMap>({});
const RefreshContext = createContext<() => Promise<void>>(async () => {});

export function PricesProvider({
  value,
  children,
}: {
  value: DisplayPriceMap;
  children: React.ReactNode;
}) {
  // Seeded from the server (SSR) map, then refreshable client-side so the
  // displayed price stays current after a mid-session admin edit / publish
  // (Codex re-audit). The checkout also reconciles the total server-side as
  // the airtight backstop.
  const [map, setMap] = useState<DisplayPriceMap>(value);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/prices', { cache: 'no-store' });
      if (res.ok) setMap((await res.json()) as DisplayPriceMap);
    } catch {
      // keep the current map on a transient failure
    }
  }, []);

  // Re-fetch when the tab regains focus (a price may have changed while the
  // page sat in the background).
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [refresh]);

  return (
    <PricesContext.Provider value={map}>
      <RefreshContext.Provider value={refresh}>{children}</RefreshContext.Provider>
    </PricesContext.Provider>
  );
}

/** Force a re-fetch of the live price map (e.g. after a PRICES_CHANGED 409). */
export function useRefreshPrices(): () => Promise<void> {
  return useContext(RefreshContext);
}

/** The one hook — read the whole map once, then use the pure helpers below
 *  (so components can map over sizes without calling hooks in a loop). */
export function usePriceMap(): DisplayPriceMap {
  return useContext(PricesContext);
}

/**
 * Whether a (category, size) is OFFERABLE. Standard sizes are always offerable
 * (they fall back to the legacy `GRID_CONFIGS` price). The single tile (size 1)
 * is a v2-only product with no legacy variant, so it's offerable ONLY when the
 * live map actually carries its price — otherwise (pre-publish / v2 outage) it
 * must not be shown or priced, or the builder would offer a dead $67 option
 * that can't check out (Codex full audit).
 */
export function isGridAvailable(
  map: DisplayPriceMap,
  category: CategoryType | null | undefined,
  gridSize: GridSize,
): boolean {
  const live = category ? map[category]?.[gridSize] : undefined;
  if (live != null) return true;
  return gridSize !== 1; // everything but the single tile has a legacy fallback
}

/** Live price for (category, size); legacy size-based grid-config fallback —
 *  except the v2-only single tile, which has no legacy/seed price. */
export function priceFor(
  map: DisplayPriceMap,
  category: CategoryType | null | undefined,
  gridSize: GridSize,
): number {
  const live = category ? map[category]?.[gridSize] : undefined;
  if (live != null) return live;
  if (gridSize === 1) return 0; // single tile is v2-only — never synthesize it
  return GRID_CONFIGS[gridSize]?.price ?? 0;
}

/** Cheapest OFFERABLE price across a category's allowed sizes (for "desde $X"). */
export function categoryMinPrice(map: DisplayPriceMap, category: CategoryType): number {
  let min = Infinity;
  for (const size of CATEGORY_REGISTRY[category].allowedGridSizes) {
    if (!isGridAvailable(map, category, size as GridSize)) continue;
    const price = priceFor(map, category, size as GridSize);
    if (price > 0 && price < min) min = price;
  }
  return Number.isFinite(min) ? min : 0;
}

/**
 * PR-C — cheapest STANDARD (non-single-tile, size > 1) price across all
 * categories. Drives the client minimum-order gate; mirrors the server's
 * `getCheapestStandardPrice`. Returns null when none is known.
 */
export function cheapestStandardPrice(map: DisplayPriceMap): number | null {
  let min: number | null = null;
  for (const sizes of Object.values(map)) {
    if (!sizes) continue;
    for (const [sizeStr, price] of Object.entries(sizes)) {
      if (Number(sizeStr) <= 1) continue; // exclude the single tile
      if (price != null && (min == null || price < min)) min = price;
    }
  }
  return min;
}

/** Convenience single-value hook (not for loops). */
export function usePrice(
  category: CategoryType | null | undefined,
  gridSize: GridSize,
): number {
  return priceFor(useContext(PricesContext), category, gridSize);
}
