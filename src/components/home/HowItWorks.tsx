'use client';

import { useRef } from 'react';
import { motion, useInView } from 'framer-motion';
import { useTranslations } from 'next-intl';

/* ── Animation variants ── */
const sectionVariants = {
  hidden: {},
  visible: {
    transition: {
      staggerChildren: 0.15,
      delayChildren: 0.1,
    },
  },
};

const headingVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.6, ease: [0.16, 1, 0.3, 1] as const },
  },
} as const;

const stepVariants = {
  hidden: { opacity: 0, y: 32 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.6, ease: [0.16, 1, 0.3, 1] as const },
  },
} as const;

/* ── Step icons ── */
function GridIcon() {
  return (
    <svg
      width="32"
      height="32"
      viewBox="0 0 32 32"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="4" y="4" width="10" height="10" rx="2" />
      <rect x="18" y="4" width="10" height="10" rx="2" />
      <rect x="4" y="18" width="10" height="10" rx="2" />
      <rect x="18" y="18" width="10" height="10" rx="2" />
    </svg>
  );
}

function CameraIcon() {
  return (
    <svg
      width="32"
      height="32"
      viewBox="0 0 32 32"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 10a2 2 0 012-2h3.172a2 2 0 001.414-.586l1.828-1.828A2 2 0 0113.828 5h4.344a2 2 0 011.414.586l1.828 1.828A2 2 0 0022.828 8H26a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V10z" />
      <circle cx="16" cy="17" r="5" />
      <circle cx="16" cy="17" r="2" />
    </svg>
  );
}

function PackageIcon() {
  return (
    <svg
      width="32"
      height="32"
      viewBox="0 0 32 32"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M16 3L28 9v14l-12 6L4 23V9l12-6z" />
      <path d="M16 15l12-6" />
      <path d="M16 15L4 9" />
      <path d="M16 15v14" />
      <path d="M22 6l-12 6" />
    </svg>
  );
}

const steps = [
  { number: '01', icon: GridIcon, titleKey: 'step1Title' as const, descKey: 'step1Desc' as const },
  { number: '02', icon: CameraIcon, titleKey: 'step2Title' as const, descKey: 'step2Desc' as const },
  { number: '03', icon: PackageIcon, titleKey: 'step3Title' as const, descKey: 'step3Desc' as const },
];

export function HowItWorks() {
  const t = useTranslations('howItWorks');
  const sectionRef = useRef<HTMLElement>(null);
  const isInView = useInView(sectionRef, { once: true, amount: 0.2 });

  return (
    <section
      ref={sectionRef}
      className="relative bg-warm-white py-12 sm:py-20 lg:py-28"
    >
      <div className="container-mosaiko">
        <motion.div
          variants={sectionVariants}
          initial="hidden"
          animate={isInView ? 'visible' : 'hidden'}
        >
          {/* ── Section heading ── */}
          <motion.div variants={headingVariants} className="text-center">
            <h2 className="font-serif text-3xl font-bold text-charcoal sm:text-4xl lg:text-5xl">
              {t('title')}
            </h2>
            <p className="mx-auto mt-4 max-w-md text-base text-warm-gray sm:text-lg">
              {t('subtitle')}
            </p>
          </motion.div>

          {/* ── Steps ── */}
          <div className="relative mt-16 sm:mt-20 lg:mt-24">
            {/* Desktop connecting line */}
            <div className="absolute left-0 right-0 top-[68px] hidden lg:block">
              <div className="mx-auto" style={{ width: '60%' }}>
                <svg
                  width="100%"
                  height="4"
                  viewBox="0 0 600 4"
                  preserveAspectRatio="none"
                  aria-hidden="true"
                >
                  <line
                    x1="0"
                    y1="2"
                    x2="600"
                    y2="2"
                    stroke="var(--light-gray)"
                    strokeWidth="2"
                    strokeDasharray="8 6"
                  />
                </svg>
              </div>
            </div>

            <div className="grid gap-12 sm:gap-16 lg:grid-cols-3 lg:gap-8">
              {steps.map((step, index) => {
                const Icon = step.icon;
                return (
                  <motion.div
                    key={step.number}
                    variants={stepVariants}
                    className="relative flex flex-col items-center text-center"
                  >
                    {/* Mobile connecting line (between steps) */}
                    {index < steps.length - 1 && (
                      <div className="absolute -bottom-10 left-1/2 -translate-x-1/2 lg:hidden">
                        <svg
                          width="2"
                          height="32"
                          viewBox="0 0 2 32"
                          aria-hidden="true"
                        >
                          <line
                            x1="1"
                            y1="0"
                            x2="1"
                            y2="32"
                            stroke="var(--light-gray)"
                            strokeWidth="2"
                            strokeDasharray="4 4"
                          />
                        </svg>
                      </div>
                    )}

                    {/* Step number + icon container */}
                    <div className="relative">
                      {/* Number badge */}
                      <span className="absolute -left-3 -top-3 z-10 flex h-7 w-7 items-center justify-center rounded-full bg-gold text-xs font-bold text-charcoal shadow-sm">
                        {step.number}
                      </span>
                      {/* Icon circle */}
                      <div className="flex h-[88px] w-[88px] items-center justify-center rounded-2xl bg-cream text-charcoal shadow-sm ring-1 ring-light-gray/50 transition-all duration-300 lg:h-[96px] lg:w-[96px]">
                        <Icon />
                      </div>
                    </div>

                    {/* Text */}
                    <h3 className="mt-6 font-serif text-xl font-semibold text-charcoal sm:text-2xl">
                      {t(step.titleKey)}
                    </h3>
                    <p className="mt-2.5 max-w-xs text-base leading-relaxed text-warm-gray">
                      {t(step.descKey)}
                    </p>
                  </motion.div>
                );
              })}
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
