'use client';

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';

const STORAGE_KEY = 'mosaiko-announcement-dismissed';

export function AnnouncementBar() {
  const t = useTranslations('announcement');
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    const wasDismissed = sessionStorage.getItem(STORAGE_KEY) === 'true';
    setDismissed(wasDismissed);
  }, []);

  function handleDismiss() {
    setDismissed(true);
    sessionStorage.setItem(STORAGE_KEY, 'true');
  }

  if (dismissed) return null;

  return (
    <div
      className="relative flex h-[var(--announcement-height)] items-center justify-center overflow-hidden bg-terracotta"
      style={{ zIndex: 'var(--z-header)' }}
    >
      <div className="announcement-scroll flex items-center whitespace-nowrap px-4 text-sm font-medium text-gold sm:whitespace-normal sm:text-center">
        <span>{t('text')}</span>
      </div>

      {/* Touch target sized ≥48px per the mobile accessibility guideline,
          even though the visible glyph stays compact. */}
      <button
        onClick={handleDismiss}
        className="absolute right-0 top-1/2 flex h-12 w-12 -translate-y-1/2 items-center justify-center text-gold/70 transition-colors hover:text-gold cursor-pointer"
        aria-label="Cerrar anuncio"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 14 14"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <path d="M1 1l12 12M13 1L1 13" />
        </svg>
      </button>
    </div>
  );
}
