'use client';

import { useRef } from 'react';
import { motion, useInView } from 'framer-motion';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';

/* ── Animation variants ── */
const containerVariants = {
  hidden: {},
  visible: {
    transition: {
      staggerChildren: 0.12,
      delayChildren: 0.1,
    },
  },
};

const fadeUp = {
  hidden: { opacity: 0, y: 20 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.6, ease: [0.16, 1, 0.3, 1] as [number, number, number, number] },
  },
};

export function CtaBanner() {
  const t = useTranslations('ctaBanner');
  const sectionRef = useRef<HTMLElement>(null);
  const isInView = useInView(sectionRef, { once: true, amount: 0.3 });

  return (
    <section
      ref={sectionRef}
      className="relative overflow-hidden bg-cta py-12 sm:py-20 lg:py-24"
    >
      {/* ── Background layers ── */}

      {/* Subtle diagonal pattern */}
      <div
        className="absolute inset-0 opacity-[0.06]"
        style={{
          backgroundImage:
            'repeating-linear-gradient(45deg, transparent, transparent 20px, rgba(255,255,255,1) 20px, rgba(255,255,255,1) 21px)',
        }}
      />

      {/* Radial highlight */}
      <div
        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
        style={{
          width: '800px',
          height: '400px',
          background:
            'radial-gradient(ellipse, rgba(255,255,255,0.06) 0%, transparent 60%)',
        }}
      />

      {/* ── Floating decorative tiles ── */}
      {/* Top-left tile */}
      <div
        className="absolute -left-4 top-8 h-16 w-16 rounded-xl opacity-[0.08] sm:left-8 sm:h-20 sm:w-20"
        style={{
          background: 'white',
          transform: 'rotate(-12deg)',
        }}
      />
      {/* Top-right tile */}
      <div
        className="absolute -right-2 top-12 h-12 w-12 rounded-lg opacity-[0.06] sm:right-12 sm:h-16 sm:w-16"
        style={{
          background: 'white',
          transform: 'rotate(8deg)',
        }}
      />
      {/* Bottom-left tile */}
      <div
        className="absolute bottom-6 left-12 h-10 w-10 rounded-lg opacity-[0.05] sm:left-24"
        style={{
          background: 'white',
          transform: 'rotate(15deg)',
        }}
      />
      {/* Bottom-right tile */}
      <div
        className="absolute -right-4 bottom-10 h-14 w-14 rounded-xl opacity-[0.07] sm:right-16 sm:h-18 sm:w-18"
        style={{
          background: 'white',
          transform: 'rotate(-6deg)',
        }}
      />
      {/* Extra small accent */}
      <div
        className="absolute bottom-20 left-1/4 hidden h-8 w-8 rounded-md opacity-[0.04] lg:block"
        style={{
          background: 'white',
          transform: 'rotate(22deg)',
        }}
      />

      {/* ── Content ── */}
      <div className="container-mosaiko relative z-10">
        <motion.div
          variants={containerVariants}
          initial="hidden"
          animate={isInView ? 'visible' : 'hidden'}
          className="flex flex-col items-center text-center"
        >
          <motion.h2
            variants={fadeUp}
            className="font-serif text-3xl font-bold leading-tight text-white sm:text-4xl lg:text-5xl xl:text-[3.5rem]"
          >
            {t('title')}
          </motion.h2>

          <motion.p
            variants={fadeUp}
            className="mt-4 max-w-lg text-base text-white/80 sm:text-lg lg:text-xl"
          >
            {t('subtitle')}
          </motion.p>

          <motion.div variants={fadeUp} className="mt-8 sm:mt-10">
            <Link
              href="/personalizar"
              className="group inline-flex min-h-[52px] items-center justify-center gap-2.5 rounded-xl bg-[var(--cta-text)] px-8 py-3.5 text-base font-bold text-cta shadow-xl shadow-black/10 transition-all duration-300 hover:bg-cream hover:shadow-2xl hover:shadow-black/15 active:scale-[0.98] sm:px-10 sm:text-lg"
            >
              {t('cta')}
              <svg
                width="18"
                height="18"
                viewBox="0 0 18 18"
                fill="none"
                aria-hidden="true"
                className="transition-transform duration-300 group-hover:translate-x-1"
              >
                <path
                  d="M3.75 9h10.5M9.75 4.5L14.25 9l-4.5 4.5"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </Link>
          </motion.div>
        </motion.div>
      </div>
    </section>
  );
}
