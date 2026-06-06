'use client';

import { useRef } from 'react';
import { motion, useInView } from 'framer-motion';
import { useTranslations } from 'next-intl';

/* ── Animation variants ── */
const ease = [0.16, 1, 0.3, 1] as [number, number, number, number];

const sectionVariants = {
  hidden: {},
  visible: {
    transition: {
      staggerChildren: 0.12,
      delayChildren: 0.1,
    },
  },
};

const fadeUp = {
  hidden: { opacity: 0, y: 24 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.6, ease },
  },
};

/* ── SVG Icons ── */
function WhatsAppIcon() {
  return (
    <svg
      width="28"
      height="28"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
    </svg>
  );
}

function MailIcon() {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
    </svg>
  );
}

/* ── Business settings prop (subset relevant to the contact page) ── */
export interface ContactBusiness {
  whatsapp: string;
  whatsappMessage?: string;
}

/**
 * Builds a wa.me link from a stored WhatsApp number (digits only). When a
 * prefill `message` is provided, it's appended as `?text=` so WhatsApp opens
 * with the chat pre-loaded.
 */
function waLink(whatsapp: string, message?: string): string | null {
  const digits = whatsapp.replace(/[^\d]/g, '');
  if (digits.length < 8) return null;
  const base = `https://wa.me/${digits}`;
  const trimmed = message?.trim();
  return trimmed ? `${base}?text=${encodeURIComponent(trimmed)}` : base;
}

/* ── Component ── */
export function ContactContent({ business }: { business?: ContactBusiness }) {
  const t = useTranslations('contactPage');
  const whatsappHref = business?.whatsapp
    ? waLink(business.whatsapp, business.whatsappMessage)
    : null;
  const emailAddress = t('emailAddress');

  /* Refs for scroll-triggered animations */
  const headerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const headerInView = useInView(headerRef, { once: true, amount: 0.3 });
  const contentInView = useInView(contentRef, { once: true, amount: 0.2 });

  return (
    <div className="bg-warm-white">
      {/* ── Hero header ── */}
      <div
        ref={headerRef}
        className="relative overflow-hidden bg-terracotta py-16 sm:py-20 lg:py-24"
      >
        {/* Decorative background pattern */}
        <div className="absolute inset-0 opacity-[0.04]">
          <svg
            className="h-full w-full"
            viewBox="0 0 400 200"
            preserveAspectRatio="xMidYMid slice"
            aria-hidden="true"
          >
            <defs>
              <pattern
                id="contact-grid"
                width="40"
                height="40"
                patternUnits="userSpaceOnUse"
              >
                <rect width="40" height="40" fill="none" />
                <circle cx="20" cy="20" r="1.5" fill="white" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#contact-grid)" />
          </svg>
        </div>

        {/* Radial glow */}
        <div
          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
          style={{
            width: '600px',
            height: '300px',
            background:
              'radial-gradient(ellipse, rgba(255,255,255,0.05) 0%, transparent 60%)',
          }}
        />

        <div className="container-mosaiko relative z-10">
          <motion.div
            variants={sectionVariants}
            initial="hidden"
            animate={headerInView ? 'visible' : 'hidden'}
            className="text-center"
          >
            <motion.h1
              variants={fadeUp}
              className="font-serif text-3xl font-bold text-white sm:text-4xl lg:text-5xl"
            >
              {t('title')}
            </motion.h1>
            <motion.p
              variants={fadeUp}
              className="mx-auto mt-4 max-w-lg text-base text-white/75 sm:text-lg"
            >
              {t('subtitle')}
            </motion.p>
          </motion.div>
        </div>
      </div>

      {/* ── Contact options: WhatsApp + email ── */}
      <div ref={contentRef} className="container-mosaiko py-12 sm:py-16 lg:py-20">
        <motion.div
          variants={sectionVariants}
          initial="hidden"
          animate={contentInView ? 'visible' : 'hidden'}
          className="mx-auto max-w-xl space-y-6"
        >
          {/* WhatsApp card — only shown when a number is configured in
              Configuración → Negocio. */}
          {whatsappHref && (
            <motion.div
              variants={fadeUp}
              className="rounded-2xl border border-[#25D366]/20 bg-[#25D366]/5 p-6 sm:p-7"
            >
              <div className="flex items-start gap-4">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[#25D366]/15 text-[#25D366]">
                  <WhatsAppIcon />
                </div>
                <div className="min-w-0">
                  <h3 className="font-serif text-lg font-semibold text-charcoal">
                    {t('whatsappTitle')}
                  </h3>
                  <p className="mt-1 text-sm leading-relaxed text-warm-gray">
                    {t('whatsappText')}
                  </p>
                </div>
              </div>
              <a
                href={whatsappHref}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-5 inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl bg-[#25D366] px-6 py-3 text-sm font-bold text-white shadow-md shadow-[#25D366]/20 transition-all duration-300 hover:bg-[#22c55e] hover:shadow-lg hover:shadow-[#25D366]/30 active:scale-[0.98]"
              >
                <WhatsAppIcon />
                {t('whatsappCta')}
              </a>
            </motion.div>
          )}

          {/* Email card — simple mailto. */}
          <motion.div
            variants={fadeUp}
            className="rounded-2xl border border-light-gray bg-white p-6 shadow-sm sm:p-7"
          >
            <div className="flex items-start gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-cream text-charcoal">
                <MailIcon />
              </div>
              <div className="min-w-0">
                <h3 className="font-serif text-lg font-semibold text-charcoal">
                  {t('emailTitle')}
                </h3>
                <p className="mt-1 text-sm leading-relaxed text-warm-gray">
                  {t('emailPrompt')}
                </p>
              </div>
            </div>
            <a
              href={`mailto:${emailAddress}`}
              className="mt-5 inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl bg-btn-primary px-6 py-3 text-sm font-bold text-btn-text shadow-md shadow-btn-primary/20 transition-all duration-300 hover:bg-btn-primary-hover hover:shadow-lg hover:shadow-btn-primary/30 active:scale-[0.98]"
            >
              <MailIcon />
              {emailAddress}
            </a>
          </motion.div>
        </motion.div>
      </div>
    </div>
  );
}
