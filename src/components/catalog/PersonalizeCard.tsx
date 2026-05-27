'use client';

import { Link } from '@/i18n/navigation';
import { useTranslations } from 'next-intl';
import { type CategoryType } from '@/lib/customization-types';
import { buildPersonalizarHref } from '@/lib/builder-href';

interface PersonalizeCardProps {
  category: CategoryType;
  accentColor: string;
}

export function PersonalizeCard({ category, accentColor }: PersonalizeCardProps) {
  const t = useTranslations('catalogPage');

  return (
    <Link
      href={buildPersonalizarHref({ category })}
      className="group flex h-full flex-col items-center justify-center overflow-hidden rounded-xl border-2 border-dashed border-light-gray bg-warm-white/60 p-6 text-center transition-all duration-300 hover:border-terracotta/40 hover:bg-cream/80"
    >
      {/* Upload icon */}
      <div className={`mb-4 flex h-14 w-14 items-center justify-center rounded-full ${accentColor}/10 transition-transform duration-300 group-hover:scale-110`}>
        <svg
          width="28"
          height="28"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-terracotta"
          aria-hidden="true"
        >
          <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
          <polyline points="17 8 12 3 7 8" />
          <line x1="12" y1="3" x2="12" y2="15" />
        </svg>
      </div>

      <h3 className="font-serif text-sm font-semibold text-charcoal sm:text-base">
        {t('createYourOwn')}
      </h3>
      <p className="mt-1 text-xs text-warm-gray sm:text-sm">
        {t('createYourOwnDesc')}
      </p>

      {/* CTA hint */}
      <div className="mt-4 inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-cta/30 px-4 py-2 text-sm font-medium text-cta transition-all duration-200 group-hover:bg-cta group-hover:text-[var(--cta-text)] sm:min-h-[48px]">
        {t('personalizeButton')}
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className="transition-transform duration-200 group-hover:translate-x-0.5"
        >
          <polyline points="9 18 15 12 9 6" />
        </svg>
      </div>
    </Link>
  );
}
