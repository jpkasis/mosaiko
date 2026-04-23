'use client';

import { useTranslations } from 'next-intl';
import { motion, AnimatePresence } from 'framer-motion';
import { Link } from '@/i18n/navigation';
import { useCartStore, selectCartTotal, selectCartCount } from '@/lib/cart-store';
import { formatPrice } from '@/lib/grid-config';
import { CartItem } from './CartItem';
import { CheckoutButton } from './CheckoutButton';

export function CartPage() {
  const t = useTranslations('cart');
  const items = useCartStore((s) => s.items);
  const total = useCartStore(selectCartTotal);
  const count = useCartStore(selectCartCount);
  const isEmpty = items.length === 0;

  if (isEmpty) {
    return (
      <div className="container-mosaiko flex min-h-[60vh] flex-col items-center justify-center py-20 text-center">
        <div className="mb-6 flex h-32 w-32 items-center justify-center rounded-full bg-cream-dark">
          <svg
            width="56"
            height="56"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-warm-gray"
          >
            <path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z" />
            <line x1="3" y1="6" x2="21" y2="6" />
            <path d="M16 10a4 4 0 01-8 0" />
          </svg>
        </div>
        <h1 className="font-serif text-2xl font-bold text-charcoal md:text-3xl">
          {t('empty')}
        </h1>
        <p className="mt-2 text-warm-gray">{t('emptyHint')}</p>
        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <Link
            href="/personalizar"
            className="inline-flex min-h-[48px] items-center justify-center rounded-xl bg-cta px-8 py-3 font-semibold text-[var(--cta-text)] transition-colors hover:bg-[var(--cta-hover)]"
          >
            Personalizar
          </Link>
          <Link
            href="/catalogo"
            className="inline-flex min-h-[48px] items-center justify-center rounded-xl border-2 border-charcoal/15 px-8 py-3 font-semibold text-charcoal transition-colors hover:border-terracotta/30 hover:text-terracotta"
          >
            {t('continueShopping')}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="container-mosaiko py-8 md:py-12">
      <h1 className="font-serif text-2xl font-bold text-charcoal md:text-3xl">
        {t('title')}
        <span className="ml-2 text-lg font-normal text-warm-gray">
          ({count})
        </span>
      </h1>

      <div className="mt-8 lg:grid lg:grid-cols-[1fr_380px] lg:gap-10 lg:items-start">
        {/* Items list */}
        <div className="flex flex-col gap-3">
          <AnimatePresence mode="popLayout">
            {items.map((item) => (
              <CartItem key={item.id} item={item} size="full" />
            ))}
          </AnimatePresence>

          {/* Continue shopping nudge — sits below items, above summary on mobile. */}
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
            className="mt-4 flex flex-col items-center gap-2"
          >
            <Link
              href="/catalogo"
              className="group inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl border-2 border-charcoal/15 bg-white px-6 py-3 text-sm font-semibold text-charcoal transition-colors hover:border-terracotta/40 hover:text-terracotta sm:w-auto"
            >
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
                className="transition-transform group-hover:-translate-x-1"
              >
                <path d="M19 12H5" />
                <path d="M12 19l-7-7 7-7" />
              </svg>
              {t('continueShopping')}
            </Link>
            <p className="text-center font-serif text-xs italic text-warm-gray">
              {t('continueShoppingHint')}
            </p>
          </motion.div>
        </div>

        {/* Order summary */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="mt-8 lg:sticky lg:top-[calc(var(--header-height)+2rem)] lg:mt-0"
        >
          <div className="rounded-2xl border border-light-gray bg-white p-6 shadow-sm">
            <h2 className="font-serif text-lg font-semibold text-charcoal">
              Resumen del pedido
            </h2>

            <div className="mt-5 space-y-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-warm-gray">{t('subtotal')}</span>
                <span className="text-charcoal">{formatPrice(total)}</span>
              </div>
              <div className="flex items-start justify-between text-sm">
                <span className="flex flex-col">
                  <span className="text-warm-gray">{t('shipping')}</span>
                  <span className="text-xs text-warm-gray/80">{t('shippingEta')}</span>
                </span>
                <span className="font-medium text-success">{t('free')}</span>
              </div>
              <div className="border-t border-light-gray" />
              <div className="flex items-center justify-between">
                <span className="text-base font-semibold text-charcoal">{t('total')}</span>
                <span className="text-xl font-bold text-charcoal">{formatPrice(total)}</span>
              </div>
            </div>

            <div className="mt-6">
              <CheckoutButton />
            </div>

            {/* Trust badges */}
            <div className="mt-5 flex items-center justify-center gap-4 text-xs text-warm-gray">
              <span className="flex items-center gap-1">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                  <path d="M7 11V7a5 5 0 0110 0v4" />
                </svg>
                Pago seguro
              </span>
              <span className="flex items-center gap-1">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12h14" />
                  <path d="M12 5l7 7-7 7" />
                </svg>
                Envío gratis
              </span>
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
