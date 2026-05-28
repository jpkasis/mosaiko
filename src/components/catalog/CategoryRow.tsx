'use client';

import { useRef, useState, useEffect, useCallback } from 'react';
import { motion, useInView } from 'framer-motion';
import { useTranslations } from 'next-intl';
import { type CatalogProduct, type CatalogCategory, getCategoryI18nKey } from '@/lib/catalog-data';
import { CatalogProductCard } from './CatalogProductCard';
import { PersonalizeCard } from './PersonalizeCard';

const ease = [0.16, 1, 0.3, 1] as [number, number, number, number];

const rowVariants = {
  hidden: { opacity: 0, y: 32 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.6, ease },
  },
};

interface CategoryRowProps {
  category: CatalogCategory;
  products: CatalogProduct[];
  index: number;
}

export function CategoryRow({ category, products, index }: CategoryRowProps) {
  const t = useTranslations('catalogPage');
  const sectionRef = useRef<HTMLElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const isInView = useInView(sectionRef, { once: true, amount: 0.15 });

  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const categoryLabel = t(getCategoryI18nKey(category.type));

  const updateScrollState = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 4);
    setCanScrollRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 4);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    updateScrollState();
    el.addEventListener('scroll', updateScrollState, { passive: true });
    window.addEventListener('resize', updateScrollState);
    return () => {
      el.removeEventListener('scroll', updateScrollState);
      window.removeEventListener('resize', updateScrollState);
    };
  }, [updateScrollState]);

  const scroll = useCallback((direction: 'left' | 'right') => {
    const el = scrollRef.current;
    if (!el) return;
    const cardWidth = el.querySelector('[data-card]')?.clientWidth ?? 280;
    el.scrollBy({
      left: direction === 'left' ? -cardWidth - 16 : cardWidth + 16,
      behavior: 'smooth',
    });
  }, []);

  return (
    <motion.section
      ref={sectionRef}
      id={`category-${category.type}`}
      variants={rowVariants}
      initial="hidden"
      animate={isInView ? 'visible' : 'hidden'}
      transition={{ delay: index * 0.12 }}
      className="scroll-mt-28"
      aria-label={categoryLabel}
    >
      {/* Row header */}
      <div className="container-mosaiko mb-4 flex items-baseline justify-between sm:mb-5">
        <h2 className="font-serif text-xl font-bold text-charcoal sm:text-2xl lg:text-3xl">
          {categoryLabel}
        </h2>
        <span className="text-sm text-warm-gray/60">
          {t('viewAll')}
        </span>
      </div>

      {/* Scroll container with fade edges */}
      <div className="relative">
        {/* Fade edges */}
        <div
          className={`pointer-events-none absolute left-0 top-0 z-10 h-full w-6 bg-gradient-to-r from-cream to-transparent transition-opacity duration-300 sm:w-12 lg:w-20 ${
            canScrollLeft ? 'opacity-100' : 'opacity-0'
          }`}
        />
        <div
          className={`pointer-events-none absolute right-0 top-0 z-10 h-full w-6 bg-gradient-to-l from-cream to-transparent transition-opacity duration-300 sm:w-12 lg:w-20 ${
            canScrollRight ? 'opacity-100' : 'opacity-0'
          }`}
        />

        {/* Desktop arrows */}
        {canScrollLeft && (
          <button
            onClick={() => scroll('left')}
            className="absolute left-2 top-1/2 z-20 hidden -translate-y-1/2 items-center justify-center rounded-full border border-light-gray bg-white/90 shadow-md backdrop-blur-sm transition-all hover:border-terracotta hover:text-terracotta sm:flex h-10 w-10"
            aria-label="Anterior"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
        )}
        {canScrollRight && (
          <button
            onClick={() => scroll('right')}
            className="absolute right-2 top-1/2 z-20 hidden -translate-y-1/2 items-center justify-center rounded-full border border-light-gray bg-white/90 shadow-md backdrop-blur-sm transition-all hover:border-terracotta hover:text-terracotta sm:flex h-10 w-10"
            aria-label="Siguiente"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
        )}

        {/* Scrollable cards */}
        <div
          ref={scrollRef}
          className="-mx-4 flex gap-4 overflow-x-auto px-4 pb-2 snap-x snap-mandatory scrollbar-none sm:mx-0 sm:gap-5 sm:px-[max(1rem,calc((100vw-1280px)/2+1rem))]"
        >
          {/* "Crea el tuyo / Personalizar" intro card — always first.
              Every category supports custom-builder entry (even Studio +
              Arte as-is offer an alternate custom path), so the previous
              `showPersonalizeCard` flag was dead taxonomy and got removed
              in UAT-2. */}
          <div
            data-card
            className="w-[72vw] min-w-[260px] flex-shrink-0 snap-start sm:w-auto sm:flex-[0_0_280px]"
          >
            <motion.div
              initial={{ opacity: 0, y: 16, scale: 0.97 }}
              animate={isInView ? { opacity: 1, y: 0, scale: 1 } : {}}
              transition={{ delay: index * 0.12, duration: 0.45, ease }}
              className="h-full"
            >
              <PersonalizeCard
                category={category.type}
                accentColor={category.accentColor}
              />
            </motion.div>
          </div>

          {products.map((product, i) => (
            <div
              key={product.id}
              data-card
              className="w-[72vw] min-w-[260px] flex-shrink-0 snap-start sm:w-auto sm:flex-[0_0_280px]"
            >
              <motion.div
                initial={{ opacity: 0, y: 16, scale: 0.97 }}
                animate={isInView ? { opacity: 1, y: 0, scale: 1 } : {}}
                transition={{ delay: index * 0.12 + (i + 1) * 0.06, duration: 0.45, ease }}
                className="h-full"
              >
                <CatalogProductCard product={product} />
              </motion.div>
            </div>
          ))}
        </div>
      </div>
    </motion.section>
  );
}
