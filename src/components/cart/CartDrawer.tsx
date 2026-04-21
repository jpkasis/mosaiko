'use client';

import { useEffect, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { motion, AnimatePresence } from 'framer-motion';
import { Link } from '@/i18n/navigation';
import { useCartStore, selectCartTotal, selectCartCount } from '@/lib/cart-store';
import { formatPrice } from '@/lib/grid-config';
import { CartItem } from './CartItem';
import { CheckoutButton } from './CheckoutButton';

const overlayVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1 },
} as const;

const drawerVariants = {
  hidden: { x: '100%' },
  visible: {
    x: 0,
    transition: { type: 'spring' as const, stiffness: 300, damping: 30 },
  },
  exit: {
    x: '100%',
    transition: { type: 'spring' as const, stiffness: 300, damping: 30 },
  },
};

export function CartDrawer() {
  const t = useTranslations('cart');
  const isOpen = useCartStore((s) => s.isDrawerOpen);
  const closeDrawer = useCartStore((s) => s.closeDrawer);
  const items = useCartStore((s) => s.items);
  const total = useCartStore(selectCartTotal);
  const count = useCartStore(selectCartCount);

  // Lock body scroll when drawer is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  // Close on Escape key
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        closeDrawer();
      }
    },
    [isOpen, closeDrawer],
  );

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  const isEmpty = items.length === 0;

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={t('title')}>
          {/* Overlay */}
          <motion.div
            variants={overlayVariants}
            initial="hidden"
            animate="visible"
            exit="hidden"
            transition={{ duration: 0.2 }}
            className="absolute inset-0 bg-charcoal/50 backdrop-blur-[2px]"
            onClick={closeDrawer}
            aria-hidden="true"
          />

          {/* Drawer panel */}
          <motion.aside
            variants={drawerVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            className="absolute right-0 top-0 flex h-full w-full flex-col bg-cream shadow-2xl sm:max-w-[420px]"
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-light-gray px-5 py-4">
              <h2 className="font-serif text-xl font-semibold text-charcoal">
                {t('title')}
                {count > 0 && (
                  <span className="ml-2 text-sm font-normal text-warm-gray">
                    ({count})
                  </span>
                )}
              </h2>
              <button
                onClick={closeDrawer}
                className="flex h-10 w-10 items-center justify-center rounded-lg transition-colors hover:bg-charcoal/5 cursor-pointer"
                aria-label="Cerrar carrito"
              >
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="text-charcoal"
                  aria-hidden="true"
                >
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            {/* Body */}
            {isEmpty ? (
              /* Empty state */
              <div className="flex flex-1 flex-col items-center justify-center px-8 text-center">
                {/* Illustration placeholder */}
                <div className="mb-6 flex h-28 w-28 items-center justify-center rounded-full bg-cream-dark">
                  <svg
                    width="48"
                    height="48"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="text-warm-gray"
                    aria-hidden="true"
                  >
                    <path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z" />
                    <line x1="3" y1="6" x2="21" y2="6" />
                    <path d="M16 10a4 4 0 01-8 0" />
                  </svg>
                </div>
                <p className="text-lg font-medium text-charcoal">{t('empty')}</p>
                <p className="mt-1 text-sm text-warm-gray">{t('emptyHint')}</p>
                <Link
                  href="/personalizar"
                  onClick={closeDrawer}
                  className="mt-6 inline-flex h-12 items-center justify-center rounded-lg bg-cta px-6 text-sm font-medium text-[var(--cta-text)] transition-colors hover:bg-[var(--cta-hover)]"
                >
                  {t('continueShopping')}
                </Link>
              </div>
            ) : (
              <>
                {/* Scrollable items */}
                <div className="flex-1 overflow-y-auto px-4 py-4">
                  <AnimatePresence mode="popLayout">
                    <div className="flex flex-col gap-3">
                      {items.map((item) => (
                        <CartItem key={item.id} item={item} />
                      ))}
                    </div>
                  </AnimatePresence>
                </div>

                {/* Footer / Summary */}
                <div className="border-t border-light-gray bg-white px-5 py-5">
                  {/* Subtotal */}
                  <div className="flex items-center justify-between text-sm text-warm-gray">
                    <span>{t('subtotal')}</span>
                    <span>{formatPrice(total)}</span>
                  </div>

                  {/* Shipping */}
                  <div className="mt-1.5 flex items-center justify-between text-sm">
                    <span className="text-warm-gray">{t('shipping')}</span>
                    <span className="font-medium text-success">{t('free')}</span>
                  </div>

                  {/* Divider */}
                  <div className="my-3 border-t border-light-gray" />

                  {/* Total */}
                  <div className="flex items-center justify-between">
                    <span className="text-base font-semibold text-charcoal">
                      {t('total')}
                    </span>
                    <span className="text-lg font-bold text-charcoal">
                      {formatPrice(total)}
                    </span>
                  </div>

                  {/* Checkout button */}
                  <div className="mt-4">
                    <CheckoutButton />
                  </div>

                  {/* View full cart */}
                  <Link
                    href="/carrito"
                    onClick={closeDrawer}
                    className="mt-2 block w-full text-center text-sm font-medium text-terracotta transition-colors hover:text-terracotta-dark"
                  >
                    Ver carrito completo
                  </Link>

                  {/* Continue shopping */}
                  <Link
                    href="/catalogo"
                    onClick={closeDrawer}
                    className="mt-3 block w-full text-center text-sm text-warm-gray transition-colors hover:text-charcoal"
                  >
                    {t('continueShopping')}
                  </Link>
                </div>
              </>
            )}
          </motion.aside>
        </div>
      )}
    </AnimatePresence>
  );
}
