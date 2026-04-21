'use client';

import { useTranslations } from 'next-intl';
import type { CartItem } from '@/lib/cart-store';

interface CustomizationSummaryProps {
  customizations: CartItem['customizations'];
}

/**
 * Renders a one-to-two-line summary of the custom text a user typed into
 * the builder. Shown in CartItem so custom orders read as specifically as
 * predesigned ones ("Studio — El Viaje de Chihiro"), instead of the bare
 * generic "Diseño personalizado".
 *
 * Returns null for categories without user-entered text (mosaicos, polaroid).
 */
export function CustomizationSummary({ customizations }: CustomizationSummaryProps) {
  const t = useTranslations('cart');

  if (!customizations) return null;
  const tf = customizations.textFields ?? {};

  let line: string | null = null;

  switch (customizations.categoryType) {
    case 'save-the-date': {
      const eventFirstLine = (tf.eventText ?? '').split('\n')[0].trim();
      const formattedDate = formatDisplayDate(tf.date);
      const parts = [eventFirstLine, formattedDate].filter(Boolean);
      line = parts.length > 0 ? parts.join(' · ') : null;
      break;
    }
    case 'spotify': {
      const song = (tf.songName ?? '').trim();
      const artist = (tf.artistName ?? '').trim();
      if (song && artist) line = `${song} — ${artist}`;
      else line = song || artist || null;
      break;
    }
    case 'arte': {
      const title = (tf.title ?? '').trim();
      const artist = (tf.artist ?? '').trim();
      const year = (tf.year ?? '').trim();
      const rhs = [artist, year].filter(Boolean).join(', ');
      if (title && rhs) line = `${title} · ${rhs}`;
      else line = title || rhs || null;
      break;
    }
    case 'studio': {
      const year = (tf.year ?? '').trim();
      const custom = (tf.customText ?? '').trim();
      const parts = [year, custom].filter(Boolean);
      line = parts.length > 0 ? parts.join(' · ') : null;
      break;
    }
    case 'tonos': {
      const level = customizations.tonosIntensity ?? 'medium';
      line = t('intensity', { level: t(`tonosIntensity_${level}`) });
      break;
    }
    case 'mosaicos':
    case 'polaroid':
      return null;
  }

  if (!line) return null;

  return (
    <p className="mt-0.5 truncate text-xs italic text-warm-gray" title={line}>
      {line}
    </p>
  );
}

function formatDisplayDate(iso: string | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const day = String(d.getUTCDate()).padStart(2, '0');
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const year = d.getUTCFullYear();
  return `${day}.${month}.${year}`;
}
