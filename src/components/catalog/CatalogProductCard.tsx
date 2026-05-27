'use client';

import Image from 'next/image';
import { Link } from '@/i18n/navigation';
import { useTranslations } from 'next-intl';
import { type CatalogProduct, CATEGORY_ACCENT, getCategoryI18nKey, formatPrice } from '@/lib/catalog-data';
import { buildPersonalizarHref } from '@/lib/builder-href';
import { isLayoutExample } from '@/lib/catalog-purchase-mode';

interface CatalogProductCardProps {
  product: CatalogProduct;
}

export function CatalogProductCard({ product }: CatalogProductCardProps) {
  const t = useTranslations('catalogPage');
  const accent = CATEGORY_ACCENT[product.category];
  const categoryLabel = t(getCategoryI18nKey(product.category));
  const layoutExample = isLayoutExample(product.category);

  const detailHref = {
    pathname: '/catalogo/[productId]' as const,
    params: { productId: product.id },
  };

  const detailLabel = t('viewDesign');
  const personalizeLabel = t('personalizeButton');

  const image = (
    <div className="relative aspect-square overflow-hidden bg-cream-dark">
      <Image
        src={product.image}
        alt={product.name}
        fill
        sizes="(max-width: 640px) 72vw, 280px"
        quality={90}
        className="object-contain transition-transform duration-500 ease-out group-hover:scale-105 group-focus-visible:scale-105"
      />

      <div className="absolute left-2 top-2 sm:left-3 sm:top-3">
        <span className="inline-flex items-center gap-1 rounded-full bg-charcoal/70 px-2 py-0.5 text-[10px] font-semibold text-white backdrop-blur-sm sm:px-2.5 sm:py-1 sm:text-[11px]">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="sm:h-3 sm:w-3" aria-hidden="true">
            <rect x="3" y="3" width="7" height="7" rx="1" />
            <rect x="14" y="3" width="7" height="7" rx="1" />
            <rect x="3" y="14" width="7" height="7" rx="1" />
            <rect x="14" y="14" width="7" height="7" rx="1" />
          </svg>
          {product.grid}
        </span>
      </div>

      <div className="absolute bottom-2 left-2 sm:bottom-3 sm:left-3">
        <span className={`inline-block rounded-full ${accent} px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white sm:px-3 sm:py-1 sm:text-[11px]`}>
          {categoryLabel}
        </span>
      </div>
    </div>
  );

  const summary = (
    <>
      <h3 className="truncate font-serif text-sm font-semibold text-charcoal transition-colors duration-200 group-hover:text-terracotta group-focus-visible:text-terracotta sm:text-base">
        {product.name}
      </h3>
      <div className="mt-1.5 flex items-baseline justify-between gap-2">
        <span className="text-base font-bold text-charcoal sm:text-lg">
          {formatPrice(product.price)}
        </span>
        <span className="text-[11px] text-warm-gray sm:text-xs">
          {t('pieces', { count: product.pieces })}
        </span>
      </div>
    </>
  );

  // As-is cards (Studio / Arte): single click target. Image + body
  // + button all route to the detail page where the customer buys.
  if (!layoutExample) {
    return (
      <Link
        href={detailHref}
        aria-label={`${detailLabel}: ${product.name}`}
        className="group flex h-full flex-col overflow-hidden rounded-xl bg-warm-white shadow-sm transition-all duration-300 hover:shadow-lg hover:shadow-charcoal/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-terracotta"
      >
        {image}
        <div className="flex flex-1 flex-col p-3 sm:p-4">
          {summary}
          <div className="mt-3">
            <span className="inline-flex min-h-[44px] w-full items-center justify-center rounded-lg bg-btn-primary px-4 py-2 text-sm font-semibold text-btn-text transition-all duration-200 group-hover:bg-btn-primary-hover group-focus-visible:bg-btn-primary-hover sm:min-h-[48px]">
              {detailLabel}
            </span>
          </div>
        </div>
      </Link>
    );
  }

  // Layout-example cards (Mosaicos / Tonos / STD / Spotify /
  // Polaroid): split target. Image + name + price → detail page
  // (preview the example). "Personalizar" button → builder
  // directly (skip the preview, jump to upload step).
  const builderHref = buildPersonalizarHref({
    category: product.category,
    gridSize: product.gridSize,
  });

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-xl bg-warm-white shadow-sm transition-all duration-300 hover:shadow-lg hover:shadow-charcoal/5">
      <Link
        href={detailHref}
        aria-label={`${detailLabel}: ${product.name}`}
        className="group flex flex-1 flex-col focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-terracotta"
      >
        {image}
        <div className="flex flex-1 flex-col p-3 pb-0 sm:p-4 sm:pb-0">
          {summary}
        </div>
      </Link>

      <div className="p-3 pt-3 sm:p-4 sm:pt-3">
        <Link
          href={builderHref}
          aria-label={`${personalizeLabel}: ${product.name}`}
          className="inline-flex min-h-[44px] w-full items-center justify-center rounded-lg bg-btn-primary px-4 py-2 text-sm font-semibold text-btn-text transition-all duration-200 hover:bg-btn-primary-hover active:bg-btn-primary-active focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-btn-primary sm:min-h-[48px]"
        >
          {personalizeLabel}
        </Link>
      </div>
    </div>
  );
}
