'use client';

import { useRef } from 'react';
import { motion, useInView } from 'framer-motion';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import Image from 'next/image';

/* ── Animation variants ── */
const containerVariants = {
  hidden: {},
  visible: {
    transition: {
      staggerChildren: 0.1,
      delayChildren: 0.15,
    },
  },
};

const headingVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.6, ease: [0.16, 1, 0.3, 1] as [number, number, number, number] },
  },
};

const cardVariants = {
  hidden: { opacity: 0, y: 28, scale: 0.97 },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { duration: 0.55, ease: [0.16, 1, 0.3, 1] as [number, number, number, number] },
  },
};

/* ── Category data ── */
const categories = [
  {
    slug: 'mosaicos',
    translationKey: 'mosaicos' as const,
    image: '/categories/mosaicos.png',
    accent: 'rgba(44,44,44,0.85)',
  },
  {
    slug: 'studio',
    translationKey: 'studio' as const,
    image: '/categories/studio.png',
    accent: 'rgba(27,77,79,0.85)',
  },
  {
    slug: 'arte',
    translationKey: 'arte' as const,
    image: '/categories/arte.png',
    accent: 'rgba(44,44,44,0.85)',
  },
  {
    slug: 'tonos',
    translationKey: 'tonos' as const,
    image: '/categories/tonos.png',
    accent: 'rgba(44,44,44,0.85)',
  },
];

export function FeaturedCategories() {
  const t = useTranslations('featured');
  const sectionRef = useRef<HTMLElement>(null);
  const isInView = useInView(sectionRef, { once: true, amount: 0.15 });

  return (
    <section
      ref={sectionRef}
      className="relative bg-warm-white py-20 sm:py-24 lg:py-32"
    >
      <div className="container-mosaiko">
        <motion.div
          variants={containerVariants}
          initial="hidden"
          animate={isInView ? 'visible' : 'hidden'}
        >
          {/* ── Heading ── */}
          <motion.div variants={headingVariants} className="text-center">
            <h2 className="font-serif text-3xl font-bold text-charcoal sm:text-4xl lg:text-5xl">
              {t('title')}
            </h2>
            <p className="mx-auto mt-4 max-w-md text-base text-warm-gray sm:text-lg">
              {t('subtitle')}
            </p>
          </motion.div>

          {/* ── Category cards — horizontally scrollable on mobile ── */}
          <div className="mt-12 sm:mt-16 lg:mt-20">
            {/* Mobile: horizontal scroll */}
            <div className="-mx-4 flex gap-4 overflow-x-auto px-4 pb-4 snap-x snap-mandatory scrollbar-none sm:mx-0 sm:grid sm:grid-cols-2 sm:gap-5 sm:overflow-visible sm:px-0 sm:pb-0 lg:grid-cols-4 lg:gap-6">
              {categories.map((cat) => (
                <motion.div
                  key={cat.slug}
                  variants={cardVariants}
                  className="w-[72vw] min-w-[260px] flex-shrink-0 snap-start sm:w-auto sm:min-w-0 sm:flex-shrink"
                >
                  <Link
                    href={`/catalogo`}
                    className="group relative block overflow-hidden rounded-2xl"
                  >
                    {/* Card image area */}
                    <div className="relative aspect-[4/3] overflow-hidden bg-cream-dark">
                      <Image
                        src={cat.image}
                        alt={t(cat.translationKey)}
                        fill
                        className="object-contain p-3 transition-transform duration-500 ease-out group-hover:scale-105"
                        sizes="(max-width: 640px) 72vw, (max-width: 1024px) 50vw, 25vw"
                        quality={90}
                      />
                    </div>

                    {/* Category name overlay */}
                    <div className="absolute inset-x-0 bottom-0">
                      <div
                        className="px-5 pb-5 pt-12"
                        style={{
                          background: `linear-gradient(to top, ${cat.accent} 0%, ${cat.accent.replace('0.9', '0.6')} 50%, transparent 100%)`,
                        }}
                      >
                        <h3 className="font-serif text-lg font-semibold text-white transition-transform duration-300 group-hover:translate-x-1 sm:text-xl">
                          {t(cat.translationKey)}
                        </h3>
                        <div className="mt-1 flex items-center gap-1 text-sm text-white/80 opacity-0 transition-all duration-300 group-hover:opacity-100">
                          <span>Ver coleccion</span>
                          <svg
                            width="14"
                            height="14"
                            viewBox="0 0 14 14"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            aria-hidden="true"
                          >
                            <path d="M3 7h8M8 3.5L11 7l-3 3.5" />
                          </svg>
                        </div>
                      </div>
                    </div>
                  </Link>
                </motion.div>
              ))}
            </div>
          </div>
        </motion.div>
      </div>

      {/* Hide scrollbar utility (CSS) */}
      <style jsx global>{`
        .scrollbar-none::-webkit-scrollbar {
          display: none;
        }
        .scrollbar-none {
          -ms-overflow-style: none;
          scrollbar-width: none;
        }
      `}</style>
    </section>
  );
}
