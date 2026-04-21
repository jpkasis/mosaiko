'use client';

import { useTranslations } from 'next-intl';
import type { CartItem } from '@/lib/cart-store';

interface CustomizationSummaryProps {
  customizations: CartItem['customizations'];
}

/**
 * Renders a summary of the custom text that will be printed on the magnet.
 *
 * Mirrors the print pipeline's effective output — including the Save the
 * Date placeholder fallback (`save-the-date.ts:131`) — so the cart line
 * is an honest preview of what the customer will receive. Placeholder
 * text (i.e. user did not personalize this field) renders in muted
 * italic to distinguish it from user-typed text.
 *
 * Returns null only for categories with no text concept at all (mosaicos
 * and polaroid).
 */
export function CustomizationSummary({ customizations }: CustomizationSummaryProps) {
  const t = useTranslations('cart');

  if (!customizations) return null;
  const tf = customizations.textFields ?? {};

  let text: string | null = null;
  let isPlaceholder = false;

  switch (customizations.categoryType) {
    case 'save-the-date': {
      const typed = (tf.eventText ?? '').split('\n')[0].trim();
      const formattedDate = formatDisplayDate(tf.date);
      const eventLabel = typed || 'Save the Date';
      const parts = [eventLabel, formattedDate].filter(Boolean);
      text = parts.join(' · ');
      isPlaceholder = !typed;
      break;
    }
    case 'spotify': {
      const song = (tf.songName ?? '').trim();
      const artist = (tf.artistName ?? '').trim();
      if (!song && !artist) {
        text = t('noCustomText');
        isPlaceholder = true;
      } else if (song && artist) {
        text = `${song} — ${artist}`;
      } else {
        text = song || artist;
      }
      break;
    }
    case 'arte': {
      const title = (tf.title ?? '').trim();
      const artist = (tf.artist ?? '').trim();
      const year = (tf.year ?? '').trim();
      if (!title && !artist && !year) {
        text = t('noCustomText');
        isPlaceholder = true;
      } else {
        const rhs = [artist, year].filter(Boolean).join(', ');
        text = title && rhs ? `${title} · ${rhs}` : title || rhs;
      }
      break;
    }
    case 'studio': {
      const year = (tf.year ?? '').trim();
      const studioText = (tf.studioText ?? '').trim();
      const japaneseText = (tf.japaneseText ?? '').trim();
      const customText = (tf.customText ?? '').trim();
      const parts = [year, studioText, japaneseText, customText].filter(Boolean);
      if (parts.length === 0) {
        text = t('noCustomText');
        isPlaceholder = true;
      } else {
        text = parts.join(' · ');
      }
      break;
    }
    case 'tonos': {
      const level = customizations.tonosIntensity ?? 'medium';
      text = t('intensity', { level: t(`tonosIntensity_${level}`) });
      break;
    }
    case 'mosaicos':
    case 'polaroid':
      return null;
  }

  if (!text) return null;

  const classes = isPlaceholder
    ? 'mt-0.5 truncate text-xs italic text-warm-gray/70'
    : 'mt-0.5 truncate text-xs italic text-warm-gray';

  return (
    <p className={classes} title={text}>
      {text}
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
