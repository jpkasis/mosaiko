'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { motion } from 'framer-motion';
import { useCartStore, selectCartTotal } from '@/lib/cart-store';
import { formatPrice } from '@/lib/grid-config';

export function CheckoutButton() {
  const t = useTranslations('cart');
  const items = useCartStore((s) => s.items);
  const total = useCartStore(selectCartTotal);
  const clearCart = useCartStore((s) => s.clearCart);
  const setCheckoutInProgress = useCartStore((s) => s.setCheckoutInProgress);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCheckout() {
    if (isLoading || items.length === 0) return;

    setIsLoading(true);
    setCheckoutInProgress(true);
    setError(null);

    // Primary path: POST /api/cart/save — this both persists the cart to
    // Shopify (for session restore) and returns the same hosted checkoutUrl
    // we'd get from the legacy /api/checkout call. Reusing the synced cart
    // avoids creating a duplicate one at checkout time.
    try {
      const saveRes = await fetch('/api/cart/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items }),
      });

      if (saveRes.ok) {
        const data = (await saveRes.json()) as { checkoutUrl?: string };
        if (data.checkoutUrl) {
          clearCart();
          window.location.href = data.checkoutUrl;
          return;
        }
      }
      // Fall through to legacy path if save didn't return a usable response.
    } catch {
      // Network error on save — try legacy path before surfacing an error.
    }

    // Fallback: legacy checkout endpoint. Keeps behaviour identical if the
    // new save route is misconfigured or Shopify changed under us.
    try {
      const response = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error || 'Error al procesar el pago.');
        return;
      }

      clearCart();
      window.location.href = data.checkoutUrl;
    } catch {
      setError('Error de conexión. Verifica tu internet e intenta de nuevo.');
    } finally {
      setIsLoading(false);
      setCheckoutInProgress(false);
    }
  }

  return (
    <div>
      <motion.button
        whileTap={{ scale: 0.97 }}
        transition={{ type: 'spring', stiffness: 400, damping: 17 }}
        onClick={handleCheckout}
        disabled={isLoading || items.length === 0}
        className="flex h-12 w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-cta text-base font-bold font-serif text-[var(--cta-text)] transition-colors hover:bg-[var(--cta-hover)] disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isLoading ? (
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
                strokeDasharray="31.4 31.4"
                strokeLinecap="round"
              />
            </svg>
            Procesando...
          </>
        ) : (
          /* Explicit handoff language: price + Shopify.
             Codex's cart priority was reducing "wait, what happens when I
             click" anxiety before the redirect. The hosted Shopify page
             is a trust-heavy step for MX buyers; naming it up-front plus
             the total makes the button a promise, not a mystery. */
          total > 0 ? `Pagar ${formatPrice(total)} · Shopify seguro` : t('checkout')
        )}
      </motion.button>

      {error && (
        <motion.p
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-2 text-center text-sm text-error"
        >
          {error}
        </motion.p>
      )}
    </div>
  );
}
