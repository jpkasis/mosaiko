'use client';

import { useMemo, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter, Link } from '@/i18n/navigation';
import { motion } from 'framer-motion';
import { getProductById, CATEGORY_ACCENT, type CatalogProduct } from '@/lib/catalog-data';
import { getEffectiveGridConfig } from '@/lib/grid-config';
import { CATEGORY_REGISTRY } from '@/lib/customization-types';
import { buildPersonalizarHref } from '@/lib/builder-href';
import { isLayoutExample } from '@/lib/catalog-purchase-mode';
import { Button } from '@/components/ui/Button';
import { TileGrid } from '@/components/preview/TileGrid';

interface LayoutExamplePreviewProps {
  productId: string;
  initialProduct?: CatalogProduct; // pre-fetched for dynamic products
}

/**
 * Detail-page shell for layout-example products (Mosaicos, Tonos,
 * Save the Date, Spotify, Polaroid). Same preview rendering as
 * `PredesignedPreview` — TileGrid composited example image — but the
 * primary action is "Personalizar", which deep-links into the builder
 * with the category + grid pre-selected. The example photo shown
 * here is INSPIRATION; the customer brings their own.
 *
 * Sibling of `PredesignedPreview` (Studio/Arte buyable-as-is). Both
 * are reached through `/catalogo/[productId]`; the route delegates
 * by `getPurchaseMode(product.category)`.
 */
export function LayoutExamplePreview({ productId, initialProduct }: LayoutExamplePreviewProps) {
  const t = useTranslations('catalogPage');
  const tb = useTranslations('builder');
  const tc = useTranslations('common');
  const router = useRouter();

  const product = useMemo(() => initialProduct ?? getProductById(productId), [productId, initialProduct]);
  const gridConfig = useMemo(
    () => product ? getEffectiveGridConfig(product.gridSize, product.category) : null,
    [product],
  );

  // Derive actual rows/cols from seamData when available (handles non-standard grids).
  const effectiveGrid = useMemo(() => {
    if (!product || !gridConfig) return null;
    if (product.seamData) {
      const cols = product.seamData.vertical.length + 1;
      const rows = product.seamData.horizontal.length + 1;
      return { rows, cols };
    }
    return { rows: gridConfig.rows, cols: gridConfig.cols };
  }, [product, gridConfig]);

  const handleBack = useCallback(() => {
    router.push('/catalogo');
  }, [router]);

  if (!product || !isLayoutExample(product.category) || !gridConfig || !effectiveGrid) return null;

  const categoryLabel = CATEGORY_REGISTRY[product.category].label;
  const accentClass = CATEGORY_ACCENT[product.category];
  const personalizarHref = buildPersonalizarHref({ category: product.category, gridSize: product.gridSize });

  return (
    <div className="flex flex-col gap-6">
      {/* Back link */}
      <button
        onClick={handleBack}
        className="inline-flex items-center gap-1.5 self-start text-sm font-medium text-warm-gray transition-colors hover:text-terracotta"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="15 18 9 12 15 6" />
        </svg>
        {t('backToCatalog')}
      </button>

      {/* Product heading */}
      <div className="text-center">
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="flex flex-col items-center gap-2"
        >
          <span className={`inline-block rounded-full px-3 py-1 text-xs font-medium text-white ${accentClass}`}>
            {categoryLabel}
          </span>
          <h1 className="font-serif text-2xl font-bold text-charcoal md:text-3xl">
            {product.name}
          </h1>
        </motion.div>
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.15, duration: 0.4 }}
          className="mt-2 text-sm text-warm-gray"
        >
          {t('layoutExampleSubtitle')}
        </motion.p>
      </div>

      {/* Product display — shared TileGrid component */}
      <div className="mx-auto w-full max-w-[420px]">
        {/* Hidden img for SEO/a11y alt text */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={product.image} alt={product.name} className="sr-only" />

        <TileGrid
          compositeUrl={product.image}
          rows={effectiveGrid.rows}
          cols={effectiveGrid.cols}
          categoryType={product.category}
          gridSize={gridConfig.size}
          seamData={product.seamData}
        />
      </div>

      {/* Info section */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4, duration: 0.4 }}
        className="flex flex-col gap-4"
      >
        {/* Product info card (no price — price is set by the builder grid choice) */}
        <div className="flex items-center justify-between rounded-xl bg-white px-4 py-3">
          <div className="flex flex-col">
            <span className="text-sm text-warm-gray">
              {tb(`grid${gridConfig.size}` as 'grid3' | 'grid4' | 'grid6' | 'grid9')}
            </span>
            <span className="text-xs text-warm-gray">
              {/* Arte is purchase-as-is, never reaches this shell, so the
                  Arte-specific "4×2+1" badge stays in PredesignedPreview. */}
              {`${gridConfig.rows} x ${gridConfig.cols} — ${gridConfig.size} ${tc('pieces')}`}
              {' · '}{categoryLabel}
            </span>
          </div>
        </div>

        {/* Personalizar CTA → builder deep-link */}
        <Link href={personalizarHref}>
          <Button variant="primary" size="lg" fullWidth>
            {t('personalizeButton')}
          </Button>
        </Link>

        {/* Back to catalog link */}
        <button
          onClick={handleBack}
          className="mx-auto cursor-pointer text-sm font-medium text-warm-gray underline underline-offset-2 transition-colors hover:text-terracotta"
        >
          {t('backToCatalog')}
        </button>
      </motion.div>
    </div>
  );
}
