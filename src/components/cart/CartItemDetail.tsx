'use client';

import { useEffect, useState, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { motion } from 'framer-motion';
import { Link, useRouter } from '@/i18n/navigation';
import { useCartStore } from '@/lib/cart-store';
import { CATEGORY_REGISTRY, type CategoryType } from '@/lib/customization-types';
import { CATEGORY_ACCENT } from '@/lib/catalog-data';
import { formatPrice, getEffectiveGridConfig } from '@/lib/grid-config';
import { TileGrid } from '@/components/preview/TileGrid';
import { CustomizationSummary } from './CustomizationSummary';

const KNOWN_CATEGORIES: readonly CategoryType[] = [
  'mosaicos', 'spotify', 'tonos', 'studio', 'arte', 'polaroid', 'save-the-date',
];

function asCategoryType(value: string | undefined): CategoryType | undefined {
  if (!value) return undefined;
  return (KNOWN_CATEGORIES as readonly string[]).includes(value)
    ? (value as CategoryType)
    : undefined;
}

interface CartItemDetailProps {
  itemId: string;
}

/**
 * Fridge-style preview for a single cart item. Mirrors the catalog
 * detail page's layout (`PredesignedPreview`) so the user sees stock and
 * custom mosaics in the same chrome:
 *   - back link to /carrito
 *   - category badge + name + "Así se verán tus imanes en el refrigerador"
 *   - <TileGrid> rendering the assembled composite
 *   - price + remove + back-to-cart actions
 *
 * Cart state is client-only (Zustand-persist on localStorage). Until
 * the persist plugin finishes hydrating we render nothing — otherwise
 * the page would flash a "missing item" redirect every refresh.
 *
 * Falls back to /carrito if the requested itemId doesn't exist in the
 * cart (e.g. user removed it from another tab, navigated by a stale
 * link, or typed a bad id).
 */
export function CartItemDetail({ itemId }: CartItemDetailProps) {
  const t = useTranslations('cart');
  const router = useRouter();
  const items = useCartStore((s) => s.items);
  const removeItem = useCartStore((s) => s.removeItem);
  const [hydrated, setHydrated] = useState(() =>
    useCartStore.persist.hasHydrated(),
  );

  useEffect(() => {
    if (hydrated) return;
    // Re-check after subscribing — closes the narrow window where
    // hydration finishes between the useState initializer reading
    // `hasHydrated()` (false) and this effect actually subscribing
    // via `onFinishHydration`. Codex audit LOW finding.
    if (useCartStore.persist.hasHydrated()) {
      setHydrated(true);
      return;
    }
    const unsub = useCartStore.persist.onFinishHydration(() => {
      setHydrated(true);
      unsub();
    });
    return unsub;
  }, [hydrated]);

  const item = useMemo(
    () => items.find((i) => i.id === itemId) ?? null,
    [items, itemId],
  );

  // Once persist has hydrated and we still don't have the item, the
  // user's deep-link refers to a missing item. Bounce them back to
  // /carrito gracefully instead of leaving a blank page.
  useEffect(() => {
    if (hydrated && !item) {
      router.replace('/carrito');
    }
  }, [hydrated, item, router]);

  if (!hydrated || !item) {
    return (
      <div className="container-mosaiko py-8 text-center text-sm text-warm-gray">
        {/* Intentionally minimal: hydration window is sub-second on real
            devices; a spinner would flash distractingly. */}
        {hydrated && !item ? t('itemDetailMissing') : null}
      </div>
    );
  }

  // Custom mosaics carry the full composite under `compositeUrl`;
  // `previewUrl` is the downscaled JPEG thumbnail. Both share the same
  // dev/prod storage so either works for a 420 px preview, but
  // `compositeUrl` is full-fidelity when present.
  const previewSrc = item.customizations?.compositeUrl ?? item.previewUrl;

  // Category-specific badge + label. Custom items use their
  // customizations.categoryType (a known CategoryType); predesigned
  // items store the slug as a free string we narrow defensively.
  const categoryType: CategoryType | undefined =
    item.type === 'custom'
      ? item.customizations?.categoryType
      : asCategoryType(item.categorySlug);
  const categoryLabel = categoryType
    ? CATEGORY_REGISTRY[categoryType].label
    : item.name;
  const accentClass = categoryType ? CATEGORY_ACCENT[categoryType] : undefined;

  // Effective rows / cols. Use gridLayout from the cart item (already
  // derived at add-to-cart time) so a layoutRotated Mosaicos shows
  // correctly, with TileGrid's category-aware occupiedCells filling Arte's
  // L-shape.
  const gridConfig = categoryType
    ? getEffectiveGridConfig(item.gridSize, categoryType)
    : null;

  return (
    <div className="container-mosaiko py-8 md:py-12">
      <div className="flex flex-col gap-6">
        {/* Back link */}
        <Link
          href="/carrito"
          className="inline-flex items-center gap-1.5 self-start text-sm font-medium text-warm-gray transition-colors hover:text-terracotta"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <polyline points="15 18 9 12 15 6" />
          </svg>
          {t('backToCart')}
        </Link>

        {/* Title */}
        <div className="text-center">
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
            className="flex flex-col items-center gap-2"
          >
            {accentClass && (
              <span
                className={`inline-block rounded-full px-3 py-1 text-xs font-medium text-white ${accentClass}`}
              >
                {categoryLabel}
              </span>
            )}
            <h1 className="font-serif text-2xl font-bold text-charcoal md:text-3xl">
              {item.name}
            </h1>
          </motion.div>
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.15, duration: 0.4 }}
            className="mt-2 text-sm text-warm-gray"
          >
            {t('itemDetailSubtitle')}
          </motion.p>
        </div>

        {/* Mosaic preview */}
        <div className="mx-auto w-full max-w-[420px]">
          {previewSrc ? (
            <TileGrid
              compositeUrl={previewSrc}
              rows={item.gridLayout.rows}
              cols={item.gridLayout.cols}
              categoryType={categoryType ?? undefined}
              gridSize={gridConfig?.size ?? item.gridSize}
            />
          ) : (
            // Compositional fallback: previewUrl is missing (extremely
            // rare — would mean the cart-composite endpoint didn't run
            // when the item was added, or persist serialized a
            // half-built item). The cart drawer thumb shows the same
            // grid placeholder; here we mirror it at full size.
            <div
              className="flex aspect-square w-full items-center justify-center rounded-md bg-cream-dark"
              role="img"
              aria-label={t('imageMissing')}
            >
              <svg
                width="80"
                height="80"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1"
                className="text-warm-gray/60"
                aria-hidden="true"
              >
                <rect x="3" y="3" width="7" height="7" rx="1" />
                <rect x="14" y="3" width="7" height="7" rx="1" />
                <rect x="3" y="14" width="7" height="7" rx="1" />
                <rect x="14" y="14" width="7" height="7" rx="1" />
              </svg>
            </div>
          )}
        </div>

        {/* Info card */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4, duration: 0.4 }}
          className="mx-auto flex w-full max-w-[420px] flex-col gap-4"
        >
          <div className="flex items-center justify-between rounded-xl bg-white px-4 py-3">
            <div className="flex flex-col">
              <span className="text-sm text-charcoal">
                {t('pieces', { count: item.gridSize })}
              </span>
              {item.type === 'custom' && (
                <CustomizationSummary customizations={item.customizations} />
              )}
            </div>
            <span className="text-xl font-bold text-charcoal">
              {formatPrice(item.price * item.quantity)}
            </span>
          </div>

          {/* Actions */}
          <div className="flex flex-col gap-2 sm:flex-row">
            <Link
              href="/carrito"
              className="flex-1 inline-flex min-h-[48px] items-center justify-center rounded-xl border border-charcoal/15 px-6 text-sm font-medium text-charcoal transition-colors hover:bg-charcoal/5"
            >
              {t('backToCart')}
            </Link>
            <button
              onClick={() => {
                removeItem(item.id);
                router.replace('/carrito');
              }}
              className="flex-1 inline-flex min-h-[48px] cursor-pointer items-center justify-center rounded-xl border border-error/30 px-6 text-sm font-medium text-error transition-colors hover:bg-error/5"
            >
              {t('remove')}
            </button>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
