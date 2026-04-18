'use client';

import { useRef, useState, useEffect, useCallback } from 'react';
import { motion, useInView } from 'framer-motion';
import { useTranslations } from 'next-intl';
import Image from 'next/image';
import useEmblaCarousel from 'embla-carousel-react';
import AutoScroll from 'embla-carousel-auto-scroll';

/* ── Product data ── */
type Badge = 'bestseller' | 'new' | 'limited';

interface Product {
  src: string;
  alt: string;
  category: string;
  grid: string;
  pieces: number;
  price: number;
  badge?: Badge;
}

const products: Product[] = [
  {
    src: '/products/mosaico-9-proposal.png',
    alt: 'Propuesta de matrimonio',
    category: 'Mosaicos',
    grid: '3×3',
    pieces: 9,
    price: 480,
    badge: 'bestseller',
  },
  {
    src: '/products/studio-chihiro.png',
    alt: 'El Viaje de Chihiro',
    category: 'Studio',
    grid: '2×3',
    pieces: 6,
    price: 360,
    badge: 'new',
  },
  {
    src: '/products/arte-noche-estrellada.png',
    alt: 'La Noche Estrellada',
    category: 'Arte',
    grid: '4×2+1',
    pieces: 9,
    price: 480,
  },
  {
    src: '/products/tonos-9.png',
    alt: 'Ramo de rosas',
    category: 'Tonos',
    grid: '3×3',
    pieces: 9,
    price: 480,
  },
  {
    src: '/products/polaroid-sunset.png',
    alt: 'Atardecer Polaroid',
    category: 'Polaroid',
    grid: '2×2',
    pieces: 4,
    price: 280,
  },
  {
    src: '/products/save-the-date-9.png',
    alt: 'Save the Date',
    category: 'Save the Date',
    grid: '3×3',
    pieces: 9,
    price: 480,
    badge: 'bestseller',
  },
  {
    src: '/products/arte-mona-lisa.png',
    alt: 'La Mona Lisa',
    category: 'Arte',
    grid: '4×2+1',
    pieces: 9,
    price: 480,
  },
  {
    src: '/products/studio-totoro.png',
    alt: 'Mi Vecino Totoro',
    category: 'Studio',
    grid: '2×3',
    pieces: 6,
    price: 360,
    badge: 'new',
  },
  {
    src: '/products/arte-el-beso.png',
    alt: 'El Beso — Klimt',
    category: 'Arte',
    grid: '4×2+1',
    pieces: 9,
    price: 480,
    badge: 'limited',
  },
  {
    src: '/products/studio-mononoke.png',
    alt: 'Princesa Mononoke',
    category: 'Studio',
    grid: '2×3',
    pieces: 6,
    price: 360,
  },
  {
    src: '/products/mosaico-6-family.png',
    alt: 'Familia',
    category: 'Mosaicos',
    grid: '2×3',
    pieces: 6,
    price: 360,
  },
  {
    src: '/products/mosaico-3-panoramic.png',
    alt: 'Panoramica',
    category: 'Mosaicos',
    grid: '1×3',
    pieces: 3,
    price: 200,
  },
];

const badgeStyles: Record<Badge, { label: string; bg: string }> = {
  bestseller: { label: 'Mas vendido', bg: 'bg-gold text-charcoal' },
  new: { label: 'Nuevo', bg: 'bg-charcoal text-cream' },
  limited: { label: 'Edicion limitada', bg: 'bg-terracotta text-white' },
};

const formatPrice = (price: number) =>
  new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: 'MXN',
    minimumFractionDigits: 0,
  }).format(price);

/* ── Heading animation ── */
const headingVariants = {
  hidden: { opacity: 0, y: 24 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.7, ease: [0.16, 1, 0.3, 1] as [number, number, number, number] },
  },
};

export function ProductCarousel() {
  const t = useTranslations('carousel');
  const sectionRef = useRef<HTMLElement>(null);
  const isInView = useInView(sectionRef, { once: true, amount: 0.1 });

  const [emblaRef, emblaApi] = useEmblaCarousel(
    {
      loop: true,
      align: 'start',
      slidesToScroll: 1,
      containScroll: false,
      dragFree: true,
    },
    [
      AutoScroll({
        speed: 0.6,
        startDelay: 1500,
        direction: 'forward',
        stopOnInteraction: false,
        stopOnMouseEnter: true,
        stopOnFocusIn: true,
      }),
    ]
  );

  const scrollPrev = useCallback(() => emblaApi?.scrollPrev(), [emblaApi]);
  const scrollNext = useCallback(() => emblaApi?.scrollNext(), [emblaApi]);

  // Respect prefers-reduced-motion
  useEffect(() => {
    if (!emblaApi) return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (mq.matches) {
      const autoScroll = emblaApi.plugins()?.autoScroll;
      if (autoScroll && 'stop' in autoScroll) {
        (autoScroll as { stop: () => void }).stop();
      }
    }
  }, [emblaApi]);

  return (
    <section
      ref={sectionRef}
      className="carousel-section relative overflow-hidden py-20 sm:py-24 lg:py-32"
      aria-roledescription="carousel"
      aria-label={t('title')}
    >
      {/* Heading — inside the container */}
      <motion.div
        variants={headingVariants}
        initial="hidden"
        animate={isInView ? 'visible' : 'hidden'}
        className="container-mosaiko mb-14 sm:mb-18 lg:mb-20"
      >
        <div className="flex items-end justify-between">
          <div>
            <h2 className="font-serif text-3xl font-bold text-charcoal sm:text-4xl lg:text-5xl">
              {t('title')}
            </h2>
            <p className="mt-3 max-w-lg text-base text-warm-gray sm:text-lg">
              {t('subtitle')}
            </p>
          </div>

          {/* Desktop nav arrows */}
          <div className="hidden items-center gap-2 sm:flex">
            <button
              onClick={scrollPrev}
              className="flex h-11 w-11 items-center justify-center rounded-full border border-light-gray bg-white/80 text-charcoal backdrop-blur-sm transition-all hover:border-terracotta hover:text-terracotta"
              aria-label="Anterior"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>
            <button
              onClick={scrollNext}
              className="flex h-11 w-11 items-center justify-center rounded-full border border-light-gray bg-white/80 text-charcoal backdrop-blur-sm transition-all hover:border-terracotta hover:text-terracotta"
              aria-label="Siguiente"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
          </div>
        </div>
      </motion.div>

      {/* Full-bleed gallery carousel — no card containers */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={isInView ? { opacity: 1 } : {}}
        transition={{ delay: 0.25, duration: 0.8 }}
        className="relative"
      >
        {/* Fade edges */}
        <div className="pointer-events-none absolute left-0 top-0 z-10 h-full w-10 bg-gradient-to-r from-cream to-transparent sm:w-20 lg:w-28" />
        <div className="pointer-events-none absolute right-0 top-0 z-10 h-full w-10 bg-gradient-to-l from-cream to-transparent sm:w-20 lg:w-28" />

        {/* Embla viewport */}
        <div ref={emblaRef} className="carousel-track cursor-grab overflow-hidden active:cursor-grabbing">
          <div className="flex items-center gap-3 sm:gap-4">
            {products.map((product) => (
              <div
                key={product.src}
                className="group relative min-w-0 flex-[0_0_280px] sm:flex-[0_0_340px] lg:flex-[0_0_380px]"
                aria-roledescription="slide"
              >
                {/* The image itself — no card container, just the product */}
                <div className="relative overflow-hidden rounded-xl transition-transform duration-500 ease-out group-hover:scale-[1.03]">
                  {/* Badge — always visible in top corner */}
                  {product.badge && (
                    <div className="absolute left-3 top-3 z-20">
                      <span className={`inline-block rounded-full px-3 py-1 text-[11px] font-bold uppercase tracking-wider shadow-sm ${badgeStyles[product.badge].bg}`}>
                        {badgeStyles[product.badge].label}
                      </span>
                    </div>
                  )}

                  {/* Product image — large, no padding, no background */}
                  <div className="relative aspect-square">
                    <Image
                      src={product.src}
                      alt={product.alt}
                      fill
                      className="object-contain object-center drop-shadow-lg"
                      sizes="(max-width: 640px) 320px, (max-width: 1024px) 380px, 420px"
                      quality={90}
                    />
                  </div>

                  {/* Hover overlay — elegant info reveal from bottom */}
                  <div className="absolute inset-0 z-10 flex flex-col justify-end opacity-0 transition-opacity duration-400 group-hover:opacity-100">
                    {/* Gradient scrim */}
                    <div className="absolute inset-0 bg-gradient-to-t from-charcoal/80 via-charcoal/30 to-transparent" />

                    {/* Info content */}
                    <div className="relative translate-y-3 px-5 pb-5 pt-16 transition-transform duration-400 ease-out group-hover:translate-y-0">
                      <span className="inline-block rounded-full bg-white/20 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-white/80 backdrop-blur-sm">
                        {product.category} · {product.grid}
                      </span>
                      <h3 className="mt-2 font-serif text-lg font-semibold leading-tight text-white sm:text-xl">
                        {product.alt}
                      </h3>
                      <div className="mt-2 flex items-baseline gap-2">
                        <span className="text-lg font-bold text-white">
                          {formatPrice(product.price)}
                        </span>
                        <span className="text-xs text-white/60">
                          {product.pieces} piezas
                        </span>
                      </div>
                      {/* CTA hint */}
                      <div className="mt-3 flex items-center gap-1.5 text-xs font-medium text-white/70">
                        <span>Ver detalles</span>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="9 18 15 12 9 6" />
                        </svg>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </motion.div>
    </section>
  );
}
