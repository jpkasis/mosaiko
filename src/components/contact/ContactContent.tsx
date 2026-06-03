'use client';

import { useRef, useState, type FormEvent } from 'react';
import { motion, useInView, AnimatePresence } from 'framer-motion';
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

const slideInLeft = {
  hidden: { opacity: 0, x: -32 },
  visible: {
    opacity: 1,
    x: 0,
    transition: { duration: 0.7, ease },
  },
};

const slideInRight = {
  hidden: { opacity: 0, x: 32 },
  visible: {
    opacity: 1,
    x: 0,
    transition: { duration: 0.7, ease },
  },
};

const formFieldVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.5, ease },
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

function ClockIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  );
}

function MapPinIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  );
}

function CheckCircleIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M22 11.08V12a10 10 0 11-5.93-9.14" />
      <polyline points="22 4 12 14.01 9 11.01" />
    </svg>
  );
}

function AlertCircleIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="transition-transform duration-300 group-hover:translate-x-0.5"
    >
      <line x1="22" y1="2" x2="11" y2="13" />
      <polygon points="22 2 15 22 11 13 2 9 22 2" />
    </svg>
  );
}

/* ── Form state type ── */
type FormStatus = 'idle' | 'sending' | 'success' | 'error';

/* ── Business settings prop (subset relevant to the contact page) ── */
export interface ContactBusiness {
  whatsapp: string;
  phone: string;
  address: string;
}

/** Builds a wa.me link from a stored WhatsApp number (digits only). */
function waLink(whatsapp: string): string | null {
  const digits = whatsapp.replace(/[^\d]/g, '');
  return digits.length >= 8 ? `https://wa.me/${digits}` : null;
}

/* ── Component ── */
export function ContactContent({ business }: { business?: ContactBusiness }) {
  const t = useTranslations('contactPage');
  const whatsappHref = business?.whatsapp ? waLink(business.whatsapp) : null;

  /* Refs for scroll-triggered animations */
  const headerRef = useRef<HTMLDivElement>(null);
  const formSectionRef = useRef<HTMLDivElement>(null);
  const headerInView = useInView(headerRef, { once: true, amount: 0.3 });
  const formSectionInView = useInView(formSectionRef, { once: true, amount: 0.15 });

  /* Form state */
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [status, setStatus] = useState<FormStatus>('idle');

  const isSending = status === 'sending';

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (isSending) return;

    // Basic validation
    const trimmedName = name.trim();
    const trimmedEmail = email.trim();
    const trimmedSubject = subject.trim();
    const trimmedMessage = message.trim();

    if (!trimmedName || !trimmedEmail || !trimmedSubject || !trimmedMessage) {
      setStatus('error');
      setTimeout(() => setStatus('idle'), 4000);
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(trimmedEmail)) {
      setStatus('error');
      setTimeout(() => setStatus('idle'), 4000);
      return;
    }

    setStatus('sending');

    // Simulate form submission
    setTimeout(() => {
      setStatus('success');
      setName('');
      setEmail('');
      setSubject('');
      setMessage('');

      // Reset status after 5 seconds
      setTimeout(() => setStatus('idle'), 5000);
    }, 1500);
  }

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

      {/* ── Main content: form + sidebar ── */}
      <div ref={formSectionRef} className="container-mosaiko py-12 sm:py-16 lg:py-20">
        <div className="grid gap-10 lg:grid-cols-5 lg:gap-12 xl:gap-16">
          {/* ── Left: Contact form (3/5 width on desktop) ── */}
          <motion.div
            variants={slideInLeft}
            initial="hidden"
            animate={formSectionInView ? 'visible' : 'hidden'}
            className="lg:col-span-3"
          >
            <form
              onSubmit={handleSubmit}
              noValidate
              className="rounded-2xl border border-light-gray bg-white p-6 shadow-sm sm:p-8"
            >
              <motion.div
                variants={sectionVariants}
                initial="hidden"
                animate={formSectionInView ? 'visible' : 'hidden'}
                className="space-y-5"
              >
                {/* Name */}
                <motion.div variants={formFieldVariants}>
                  <label
                    htmlFor="contact-name"
                    className="mb-1.5 block text-sm font-medium text-charcoal"
                  >
                    {t('formName')}
                  </label>
                  <input
                    id="contact-name"
                    type="text"
                    required
                    autoComplete="name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={t('formNamePlaceholder')}
                    disabled={isSending}
                    className="block w-full min-h-[48px] rounded-xl border border-light-gray bg-warm-white px-4 py-3 text-base text-charcoal placeholder:text-warm-gray/60 transition-all duration-200 focus:border-terracotta focus:ring-2 focus:ring-terracotta/20 focus:outline-none disabled:opacity-60 disabled:cursor-not-allowed"
                  />
                </motion.div>

                {/* Email */}
                <motion.div variants={formFieldVariants}>
                  <label
                    htmlFor="contact-email"
                    className="mb-1.5 block text-sm font-medium text-charcoal"
                  >
                    {t('formEmail')}
                  </label>
                  <input
                    id="contact-email"
                    type="email"
                    required
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder={t('formEmailPlaceholder')}
                    disabled={isSending}
                    className="block w-full min-h-[48px] rounded-xl border border-light-gray bg-warm-white px-4 py-3 text-base text-charcoal placeholder:text-warm-gray/60 transition-all duration-200 focus:border-terracotta focus:ring-2 focus:ring-terracotta/20 focus:outline-none disabled:opacity-60 disabled:cursor-not-allowed"
                  />
                </motion.div>

                {/* Subject */}
                <motion.div variants={formFieldVariants}>
                  <label
                    htmlFor="contact-subject"
                    className="mb-1.5 block text-sm font-medium text-charcoal"
                  >
                    {t('formSubject')}
                  </label>
                  <input
                    id="contact-subject"
                    type="text"
                    required
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    placeholder={t('formSubjectPlaceholder')}
                    disabled={isSending}
                    className="block w-full min-h-[48px] rounded-xl border border-light-gray bg-warm-white px-4 py-3 text-base text-charcoal placeholder:text-warm-gray/60 transition-all duration-200 focus:border-terracotta focus:ring-2 focus:ring-terracotta/20 focus:outline-none disabled:opacity-60 disabled:cursor-not-allowed"
                  />
                </motion.div>

                {/* Message */}
                <motion.div variants={formFieldVariants}>
                  <label
                    htmlFor="contact-message"
                    className="mb-1.5 block text-sm font-medium text-charcoal"
                  >
                    {t('formMessage')}
                  </label>
                  <textarea
                    id="contact-message"
                    required
                    rows={5}
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    placeholder={t('formMessagePlaceholder')}
                    disabled={isSending}
                    className="block w-full min-h-[120px] rounded-xl border border-light-gray bg-warm-white px-4 py-3 text-base text-charcoal placeholder:text-warm-gray/60 transition-all duration-200 resize-y focus:border-terracotta focus:ring-2 focus:ring-terracotta/20 focus:outline-none disabled:opacity-60 disabled:cursor-not-allowed"
                  />
                </motion.div>

                {/* Submit button */}
                <motion.div variants={formFieldVariants}>
                  <button
                    type="submit"
                    disabled={isSending}
                    aria-busy={isSending}
                    className="group inline-flex min-h-[52px] w-full items-center justify-center gap-2.5 rounded-xl bg-btn-primary px-8 py-3.5 text-base font-bold text-btn-text shadow-md shadow-btn-primary/20 transition-all duration-300 hover:bg-btn-primary-hover hover:shadow-lg hover:shadow-btn-primary/30 active:scale-[0.98] disabled:opacity-70 disabled:cursor-not-allowed disabled:hover:bg-btn-primary sm:w-auto sm:px-10"
                  >
                    {isSending ? (
                      <>
                        <svg
                          className="h-5 w-5 animate-spin"
                          viewBox="0 0 24 24"
                          fill="none"
                          aria-hidden="true"
                        >
                          <circle
                            cx="12"
                            cy="12"
                            r="10"
                            stroke="currentColor"
                            strokeWidth="3"
                            strokeLinecap="round"
                            className="opacity-25"
                          />
                          <path
                            d="M4 12a8 8 0 018-8"
                            stroke="currentColor"
                            strokeWidth="3"
                            strokeLinecap="round"
                          />
                        </svg>
                        {t('formSending')}
                      </>
                    ) : (
                      <>
                        {t('formSend')}
                        <SendIcon />
                      </>
                    )}
                  </button>
                </motion.div>

                {/* Status messages */}
                <AnimatePresence mode="wait">
                  {status === 'success' && (
                    <motion.div
                      key="success"
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -8 }}
                      transition={{ duration: 0.3, ease }}
                      role="status"
                      aria-live="polite"
                      className="flex items-center gap-2.5 rounded-xl bg-success/10 px-4 py-3 text-sm font-medium text-success"
                    >
                      <CheckCircleIcon />
                      {t('formSuccess')}
                    </motion.div>
                  )}
                  {status === 'error' && (
                    <motion.div
                      key="error"
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -8 }}
                      transition={{ duration: 0.3, ease }}
                      role="alert"
                      aria-live="assertive"
                      className="flex items-center gap-2.5 rounded-xl bg-error/10 px-4 py-3 text-sm font-medium text-error"
                    >
                      <AlertCircleIcon />
                      {t('formError')}
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            </form>
          </motion.div>

          {/* ── Right: Info sidebar (2/5 width on desktop) ── */}
          <motion.div
            variants={slideInRight}
            initial="hidden"
            animate={formSectionInView ? 'visible' : 'hidden'}
            className="space-y-6 lg:col-span-2"
          >
            {/* WhatsApp card — only shown when a number is configured in
                Configuración → Negocio. */}
            {whatsappHref && (
              <div className="rounded-2xl border border-[#25D366]/20 bg-[#25D366]/5 p-6 sm:p-7">
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
              </div>
            )}

            {/* Info card */}
            <div className="rounded-2xl border border-light-gray bg-white p-6 shadow-sm sm:p-7">
              <h3 className="font-serif text-lg font-semibold text-charcoal">
                {t('infoTitle')}
              </h3>

              <div className="mt-5 space-y-4">
                {/* Response time */}
                <div className="flex items-start gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-cream text-charcoal">
                    <ClockIcon />
                  </div>
                  <p className="pt-1 text-sm leading-relaxed text-warm-gray">
                    {t('responseTime')}
                  </p>
                </div>

                {/* Schedule */}
                <div className="flex items-start gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-cream text-charcoal">
                    <CalendarIcon />
                  </div>
                  <p className="pt-1 text-sm leading-relaxed text-warm-gray">
                    {t('schedule')}
                  </p>
                </div>

                {/* Location — admin address overrides the static copy when set. */}
                <div className="flex items-start gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-cream text-charcoal">
                    <MapPinIcon />
                  </div>
                  <p className="pt-1 text-sm leading-relaxed text-warm-gray">
                    {business?.address || t('location')}
                  </p>
                </div>

                {/* Phone — only when configured. */}
                {business?.phone && (
                  <div className="flex items-start gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-cream text-charcoal">
                      <WhatsAppIcon />
                    </div>
                    <p className="pt-1 text-sm leading-relaxed text-warm-gray">
                      {business.phone}
                    </p>
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </div>
  );
}
