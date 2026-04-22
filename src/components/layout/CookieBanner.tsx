'use client';

import { useState, useEffect, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { motion, AnimatePresence } from 'framer-motion';

const STORAGE_KEY = 'mosaiko-cookie-consent';

interface CookiePreferences {
  necessary: boolean;
  analytics: boolean;
  marketing: boolean;
}

const DEFAULT_PREFERENCES: CookiePreferences = {
  necessary: true,
  analytics: false,
  marketing: false,
};

const bannerVariants = {
  hidden: { y: '100%', opacity: 0 },
  visible: {
    y: 0,
    opacity: 1,
    transition: { type: 'spring' as const, stiffness: 260, damping: 28, delay: 0.8 },
  },
  exit: {
    y: '100%',
    opacity: 0,
    transition: { type: 'spring' as const, stiffness: 300, damping: 30 },
  },
} as const;

const panelVariants = {
  hidden: { height: 0, opacity: 0 },
  visible: {
    height: 'auto',
    opacity: 1,
    transition: { type: 'spring' as const, stiffness: 300, damping: 30 },
  },
  exit: {
    height: 0,
    opacity: 0,
    transition: { duration: 0.2 },
  },
} as const;

function getStoredConsent(): CookiePreferences | null {
  if (typeof window === 'undefined') return null;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return null;
    return JSON.parse(stored) as CookiePreferences;
  } catch {
    return null;
  }
}

function storeConsent(preferences: CookiePreferences) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
}

/**
 * Updates Google consent mode (gtag) when preferences change.
 * This ensures Google Analytics / Ads respect user choices (GDPR-style).
 */
function updateGoogleConsent(preferences: CookiePreferences) {
  if (typeof window === 'undefined') return;
  const gtag = (window as unknown as { gtag?: (...args: unknown[]) => void }).gtag;
  if (typeof gtag !== 'function') return;

  gtag('consent', 'update', {
    analytics_storage: preferences.analytics ? 'granted' : 'denied',
    ad_storage: preferences.marketing ? 'granted' : 'denied',
    ad_user_data: preferences.marketing ? 'granted' : 'denied',
    ad_personalization: preferences.marketing ? 'granted' : 'denied',
  });
}

export function CookieBanner() {
  const t = useTranslations('cookies');
  const [visible, setVisible] = useState(false);
  const [showPreferences, setShowPreferences] = useState(false);
  const [preferences, setPreferences] = useState<CookiePreferences>(DEFAULT_PREFERENCES);

  useEffect(() => {
    const stored = getStoredConsent();
    if (stored) {
      updateGoogleConsent(stored);
    } else {
      setVisible(true);
    }
  }, []);

  const acceptAll = useCallback(() => {
    const allAccepted: CookiePreferences = {
      necessary: true,
      analytics: true,
      marketing: true,
    };
    storeConsent(allAccepted);
    updateGoogleConsent(allAccepted);
    setVisible(false);
  }, []);

  const savePreferences = useCallback(() => {
    const finalPreferences = { ...preferences, necessary: true };
    storeConsent(finalPreferences);
    updateGoogleConsent(finalPreferences);
    setVisible(false);
  }, [preferences]);

  const togglePreference = useCallback((key: keyof Omit<CookiePreferences, 'necessary'>) => {
    setPreferences((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          role="dialog"
          aria-label={t('title')}
          variants={bannerVariants}
          initial="hidden"
          animate="visible"
          exit="exit"
          className="fixed inset-x-0 bottom-0 px-4 pb-4 sm:px-6 sm:pb-6"
          style={{ zIndex: 'var(--z-cookie)' }}
        >
          <div className="mx-auto max-w-xl rounded-2xl border border-light-gray/60 bg-warm-white/80 p-5 shadow-lg backdrop-blur-xl sm:p-6">
            {/* Cookie icon + title */}
            <div className="flex items-start gap-3">
              <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gold/15 text-lg" aria-hidden="true">
                🍪
              </span>
              <div className="min-w-0 flex-1">
                <h2 className="font-serif text-base font-semibold text-charcoal sm:text-lg">
                  {t('title')}
                </h2>
                <p className="mt-1 text-sm leading-relaxed text-warm-gray">
                  {t('description')}
                </p>
              </div>
            </div>

            {/* Preference toggles */}
            <AnimatePresence>
              {showPreferences && (
                <motion.div
                  variants={panelVariants}
                  initial="hidden"
                  animate="visible"
                  exit="exit"
                  className="overflow-hidden"
                >
                  <div className="mt-4 space-y-3 rounded-xl border border-light-gray/40 bg-cream/60 p-4">
                    {/* Necessary -- always on */}
                    <ToggleRow
                      label={t('necessary')}
                      checked={true}
                      disabled
                      onChange={() => {}}
                    />
                    {/* Analytics */}
                    <ToggleRow
                      label={t('analytics')}
                      checked={preferences.analytics}
                      onChange={() => togglePreference('analytics')}
                    />
                    {/* Marketing */}
                    <ToggleRow
                      label={t('marketing')}
                      checked={preferences.marketing}
                      onChange={() => togglePreference('marketing')}
                    />
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Actions */}
            <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
              {!showPreferences ? (
                <button
                  type="button"
                  onClick={() => setShowPreferences(true)}
                  className="min-h-[48px] cursor-pointer rounded-lg px-5 py-2.5 text-sm font-medium text-warm-gray transition-colors hover:bg-cream-dark hover:text-charcoal focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-terracotta"
                >
                  {t('configure')}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={savePreferences}
                  className="min-h-[48px] cursor-pointer rounded-lg px-5 py-2.5 text-sm font-medium text-warm-gray transition-colors hover:bg-cream-dark hover:text-charcoal focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-terracotta"
                >
                  {t('savePreferences')}
                </button>
              )}
              <button
                type="button"
                onClick={acceptAll}
                className="min-h-[48px] cursor-pointer rounded-lg bg-btn-primary px-6 py-2.5 text-sm font-medium text-btn-text transition-colors hover:bg-btn-primary-hover active:bg-btn-primary-active focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-btn-primary"
              >
                {t('accept')}
              </button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/* ── Toggle Row ── */

interface ToggleRowProps {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: () => void;
}

function ToggleRow({ label, checked, disabled = false, onChange }: ToggleRowProps) {
  return (
    <label className="flex min-h-[48px] cursor-pointer items-center justify-between gap-3">
      <span className="text-sm font-medium text-charcoal">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={onChange}
        className={[
          'relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors duration-200',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-terracotta',
          checked ? 'bg-terracotta' : 'bg-light-gray',
          disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer',
        ].join(' ')}
      >
        <span
          aria-hidden="true"
          className={[
            'pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-200',
            checked ? 'translate-x-5' : 'translate-x-0',
          ].join(' ')}
        />
      </button>
    </label>
  );
}
