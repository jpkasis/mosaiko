'use client';

import { useRef } from 'react';
import { motion, useInView } from 'framer-motion';
import { useTranslations } from 'next-intl';

/* ── Animation variants ── */
const containerVariants = {
  hidden: {},
  visible: {
    transition: {
      staggerChildren: 0.1,
      delayChildren: 0.1,
    },
  },
};

const badgeVariants = {
  hidden: { opacity: 0, y: 24 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.5, ease: [0.16, 1, 0.3, 1] as const },
  },
} as const;

/* ── Badge icons ── */
function ShieldIcon() {
  return (
    <svg
      width="28"
      height="28"
      viewBox="0 0 28 28"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M14 3L4 7.5v6.5c0 5.6 4.3 10.8 10 12 5.7-1.2 10-6.4 10-12V7.5L14 3z" />
      <path d="M10 14l2.5 2.5L18 11" />
    </svg>
  );
}

function TruckIcon() {
  return (
    <svg
      width="28"
      height="28"
      viewBox="0 0 28 28"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 5h12v13H3V5z" />
      <path d="M15 11h4.5L23 15v3h-8V11z" />
      <circle cx="8" cy="20" r="2" />
      <circle cx="20" cy="20" r="2" />
      <path d="M10 20h7" />
    </svg>
  );
}

function HeartCheckIcon() {
  return (
    <svg
      width="28"
      height="28"
      viewBox="0 0 28 28"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M14 24s-9-5.5-9-12a5.5 5.5 0 0111 0 5.5 5.5 0 0111 0c0 6.5-9 12-9 12z" />
      <path d="M10.5 14l2 2L17 12" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg
      width="28"
      height="28"
      viewBox="0 0 28 28"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="6" y="13" width="16" height="11" rx="2" />
      <path d="M9 13V9a5 5 0 0110 0v4" />
      <circle cx="14" cy="18.5" r="1.5" fill="currentColor" stroke="none" />
      <path d="M14 20v1.5" />
    </svg>
  );
}

const badges = [
  { icon: ShieldIcon, titleKey: 'quality' as const, descKey: 'qualityDesc' as const },
  { icon: TruckIcon, titleKey: 'shipping' as const, descKey: 'shippingDesc' as const },
  { icon: HeartCheckIcon, titleKey: 'satisfaction' as const, descKey: 'satisfactionDesc' as const },
  { icon: LockIcon, titleKey: 'secure' as const, descKey: 'secureDesc' as const },
];

export function TrustBadges() {
  const t = useTranslations('trustBadges');
  const sectionRef = useRef<HTMLElement>(null);
  const isInView = useInView(sectionRef, { once: true, amount: 0.2 });

  return (
    <section
      ref={sectionRef}
      className="relative bg-cream-dark py-12 sm:py-20 lg:py-24"
    >
      {/* Subtle top border */}
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-light-gray to-transparent" />

      <div className="container-mosaiko">
        <motion.div
          variants={containerVariants}
          initial="hidden"
          animate={isInView ? 'visible' : 'hidden'}
          className="grid grid-cols-2 gap-6 sm:gap-8 lg:grid-cols-4 lg:gap-6"
        >
          {badges.map((badge) => {
            const Icon = badge.icon;
            return (
              <motion.div
                key={badge.titleKey}
                variants={badgeVariants}
                whileHover={{ y: -4, transition: { duration: 0.25 } }}
                className="group flex flex-col items-center text-center"
              >
                {/* Icon container */}
                <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-terracotta/10 text-terracotta transition-all duration-300 group-hover:bg-terracotta group-hover:text-white group-hover:shadow-lg group-hover:shadow-terracotta/20 sm:h-[72px] sm:w-[72px]">
                  <Icon />
                </div>

                {/* Text */}
                <h3 className="mt-4 font-serif text-base font-semibold text-charcoal sm:text-lg">
                  {t(badge.titleKey)}
                </h3>
                <p className="mt-1.5 max-w-[200px] text-sm leading-relaxed text-warm-gray sm:text-[0.9375rem]">
                  {t(badge.descKey)}
                </p>
              </motion.div>
            );
          })}
        </motion.div>
      </div>

      {/* Subtle bottom border */}
      <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-light-gray to-transparent" />
    </section>
  );
}
