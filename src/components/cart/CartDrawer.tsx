'use client';

import { AnimatePresence } from 'framer-motion';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { useCartStore, selectCartTotal, selectCartCount } from '@/lib/cart-store';
import { formatPrice } from '@/lib/grid-config';
import { Overlay } from '@/components/ui/Overlay';
import { CartItem } from './CartItem';
import { CheckoutButton } from './CheckoutButton';

export function CartDrawer() {
  const t = useTranslations('cart');
  const isOpen = useCartStore((s) => s.isDrawerOpen);
  const closeDrawer = useCartStore((s) => s.closeDrawer);
  const items = useCartStore((s) => s.items);
  const total = useCartStore(selectCartTotal);
  const count = useCartStore(selectCartCount);

  const isEmpty = items.length === 0;

  return (
    <Overlay
      open={isOpen}
      onOpenChange={(open) => { if (!open) closeDrawer(); }}
      variant="drawer-right"
      zLayer="drawer"
      ariaLabel={t('title')}
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
          className="flex h-12 w-12 items-center justify-center rounded-lg transition-colors hover:bg-charcoal/5 cursor-pointer"
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
            className="mt-6 inline-flex min-h-[48px] items-center justify-center rounded-lg bg-cta px-6 text-sm font-medium text-[var(--cta-text)] transition-colors hover:bg-[var(--cta-hover)]"
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

          {/* Footer / Summary — safe-area padding so the checkout button
              clears the iOS home bar without the underlying content
              shifting up on every open. */}
          <div className="border-t border-light-gray bg-white px-5 py-5 pb-safe" style={{ ['--safe-min' as string]: '1.25rem' }}>
            <div className="flex items-center justify-between text-sm text-warm-gray">
              <span>{t('subtotal')}</span>
              <span>{formatPrice(total)}</span>
            </div>

            <div className="mt-1.5 flex items-center justify-between text-sm">
              <span className="text-warm-gray">{t('shipping')}</span>
              <span className="font-medium text-success">{t('free')}</span>
            </div>

            <div className="my-3 border-t border-light-gray" />

            <div className="flex items-center justify-between">
              <span className="text-base font-semibold text-charcoal">
                {t('total')}
              </span>
              <span className="text-lg font-bold text-charcoal">
                {formatPrice(total)}
              </span>
            </div>

            <div className="mt-4">
              <CheckoutButton />
            </div>

            <Link
              href="/carrito"
              onClick={closeDrawer}
              className="mt-2 block w-full text-center text-sm font-medium text-terracotta transition-colors hover:text-terracotta-dark"
            >
              Ver carrito completo
            </Link>

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
    </Overlay>
  );
}
