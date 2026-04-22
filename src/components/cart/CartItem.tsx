'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { motion } from 'framer-motion';
import { useCartStore, type CartItem as CartItemType } from '@/lib/cart-store';
import { formatPrice } from '@/lib/grid-config';
import { CATEGORY_REGISTRY } from '@/lib/customization-types';
import { CustomizationSummary } from './CustomizationSummary';

interface CartItemProps {
  item: CartItemType;
  size?: 'compact' | 'full';
}

export function CartItem({ item, size = 'compact' }: CartItemProps) {
  const t = useTranslations('cart');
  const removeItem = useCartStore((s) => s.removeItem);
  const updateQuantity = useCartStore((s) => s.updateQuantity);
  const [imgFailed, setImgFailed] = useState(false);

  const thumbnailSize = size === 'full' ? 'h-24 w-24 sm:h-28 sm:w-28' : 'h-20 w-20';
  const displayName =
    item.type === 'custom'
      ? item.customizations
        ? CATEGORY_REGISTRY[item.customizations.categoryType].label
        : t('customDesign')
      : item.name;
  const hasImage = Boolean(item.previewUrl) && !imgFailed;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20, height: 0, marginBottom: 0 }}
      transition={{ type: 'spring', stiffness: 300, damping: 25 }}
      className="relative flex gap-3 rounded-xl bg-white p-3 shadow-sm"
    >
      {/* Thumbnail */}
      <div
        className={`${thumbnailSize} flex-shrink-0 overflow-hidden rounded-lg bg-cream-dark`}
      >
        {hasImage ? (
          <img
            src={item.previewUrl}
            alt={displayName}
            onError={() => setImgFailed(true)}
            className="h-full w-full object-cover"
          />
        ) : (
          <div
            className="flex h-full w-full items-center justify-center"
            role="img"
            aria-label={t('imageMissing')}
          >
            <svg
              width="32"
              height="32"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              className="text-warm-gray/60"
              aria-hidden="true"
            >
              <rect x="3" y="3" width="7" height="7" rx="1" />
              <rect x="14" y="3" width="7" height="7" rx="1" />
              <rect x="3" y="14" width="7" height="7" rx="1" />
              <rect x="14" y="14" width="7" height="7" rx="1" />
            </svg>
          </div>
        )}
      </div>

      {/* Details */}
      <div className="flex min-w-0 flex-1 flex-col justify-between">
        {/* Top row: Name + Remove */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-charcoal">
              {displayName}
            </p>
            <p className="mt-0.5 text-xs text-warm-gray">
              {t('pieces', { count: item.gridSize })}
            </p>
            {item.type === 'custom' && (
              <CustomizationSummary customizations={item.customizations} />
            )}
          </div>

          {/* Remove button */}
          <button
            onClick={() => removeItem(item.id)}
            className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md text-warm-gray transition-colors hover:bg-error/10 hover:text-error cursor-pointer"
            aria-label={t('remove')}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
              <line x1="10" y1="11" x2="10" y2="17" />
              <line x1="14" y1="11" x2="14" y2="17" />
            </svg>
          </button>
        </div>

        {/* Bottom row: Quantity + Price */}
        <div className="flex items-center justify-between">
          {/* Quantity controls */}
          <div className="flex items-center gap-0">
            <button
              onClick={() => updateQuantity(item.id, item.quantity - 1)}
              disabled={item.quantity <= 1}
              className="flex h-8 w-8 items-center justify-center rounded-l-lg border border-light-gray text-charcoal transition-colors hover:bg-cream-dark disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
              aria-label="Reducir cantidad"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                aria-hidden="true"
              >
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            </button>
            <span className="flex h-8 w-10 items-center justify-center border-y border-light-gray bg-white text-sm font-medium text-charcoal">
              {item.quantity}
            </span>
            <button
              onClick={() => updateQuantity(item.id, item.quantity + 1)}
              className="flex h-8 w-8 items-center justify-center rounded-r-lg border border-light-gray text-charcoal transition-colors hover:bg-cream-dark cursor-pointer"
              aria-label="Aumentar cantidad"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                aria-hidden="true"
              >
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            </button>
          </div>

          {/* Price */}
          <p className="text-sm font-semibold text-charcoal">
            {formatPrice(item.price * item.quantity)}
          </p>
        </div>
      </div>
    </motion.div>
  );
}
