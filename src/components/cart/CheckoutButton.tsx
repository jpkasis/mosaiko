'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { motion } from 'framer-motion';
import { useCartStore } from '@/lib/cart-store';
import {
  usePriceMap,
  useRefreshPrices,
  cheapestStandardPrice,
} from '@/components/pricing/PricesProvider';
import { cartLiveTotal } from '@/lib/cart-pricing';
import { formatPrice } from '@/lib/grid-config';

export function CheckoutButton() {
  const t = useTranslations('cart');
  const items = useCartStore((s) => s.items);
  const priceMap = usePriceMap();
  const refreshPrices = useRefreshPrices();
  const total = cartLiveTotal(priceMap, items);
  const setCheckoutInProgress = useCartStore((s) => s.setCheckoutInProgress);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // PR-C: a lone single-tile order can't reach checkout. Mirror the server's
  // minimum-order gate so the button disables before the round trip; the
  // routes enforce it authoritatively (422 MINIMUM_ORDER_NOT_MET).
  const minimum = cheapestStandardPrice(priceMap);
  const belowMinimum =
    minimum != null &&
    items.length > 0 &&
    Math.round(total * 100) < Math.round(minimum * 100);

  // UAT-6 PR1: Shopify cart is the source of truth. We do NOT clear local
  // Zustand on redirect — if the user backs out from Shopify checkout, the
  // local cart should still be there. CartHydrator on the return trip will
  // reconcile against /api/cart/load, which detects a converted cart via
  // `cart(id:) === null` and clears local state at that point.
  async function handleCheckout() {
    if (isLoading || items.length === 0 || belowMinimum) return;

    setIsLoading(true);
    setCheckoutInProgress(true);
    setError(null);

    // One outer try/finally guarantees the button never stays stuck in the
    // loading / checkout-in-progress state on an early 409 return (Codex 3rd
    // audit: the primary-path 409 used to return before any reset). BUT we must
    // NOT reset on the redirect path: `checkoutInProgress` has to survive the
    // navigation to Shopify so the pagehide/visibility handlers don't treat the
    // unload as a cart-clear (UAT-6 PR1 lost-cart bug). The `redirecting` flag
    // gates the finally so only non-redirect exits reset. The inner try lets the
    // primary path fall through to the legacy endpoint on a network error.
    let redirecting = false;
    try {
      // Primary path: POST /api/cart/save — this both persists the cart to
      // Shopify (for session restore) and returns the same hosted checkoutUrl
      // we'd get from the legacy /api/checkout call. Reusing the synced cart
      // avoids creating a duplicate one at checkout time.
      try {
        const saveRes = await fetch('/api/cart/save', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ items, displayedTotal: total }),
        });

        // PR-B: price changed between page load and checkout → refresh the
        // displayed prices and ask the customer to re-confirm (never proceed at
        // a stale total).
        if (saveRes.status === 409) {
          const data = (await saveRes.json().catch(() => ({}))) as { error?: string };
          await refreshPrices();
          setError(data.error || 'Los precios se actualizaron. Revisa tu total y vuelve a continuar.');
          return;
        }

        if (saveRes.ok) {
          const data = (await saveRes.json()) as { checkoutUrl?: string };
          if (data.checkoutUrl) {
            redirecting = true;
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
      const response = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items, displayedTotal: total }),
      });

      const data = await response.json();

      if (response.status === 409) {
        await refreshPrices();
        setError(data.error || 'Los precios se actualizaron. Revisa tu total y vuelve a continuar.');
        return;
      }

      if (!response.ok) {
        setError(data.error || 'Error al procesar el pago.');
        return;
      }

      redirecting = true;
      window.location.href = data.checkoutUrl;
    } catch {
      setError('Error de conexión. Verifica tu internet e intenta de nuevo.');
    } finally {
      // Reset only when we're NOT navigating away — a redirect must leave
      // checkoutInProgress=true so the cart survives the trip to Shopify.
      if (!redirecting) {
        setIsLoading(false);
        setCheckoutInProgress(false);
      }
    }
  }

  return (
    <div>
      <motion.button
        whileTap={{ scale: 0.97 }}
        transition={{ type: 'spring', stiffness: 400, damping: 17 }}
        onClick={handleCheckout}
        disabled={isLoading || items.length === 0 || belowMinimum}
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
          /* Explicit handoff language: price + "secure payment" signal.
             Codex's cart priority was reducing "wait, what happens when I
             click" anxiety before the redirect. Keep the CTA itself
             product-branded ("Pago seguro" = trust without leaking the
             processor name); the Shopify attribution lives as a small
             support line below the button so it still reassures without
             dominating the primary action label. */
          total > 0
            ? t('checkoutPayNow', { price: formatPrice(total) })
            : t('checkout')
        )}
      </motion.button>

      {/* PR-C: minimum-order notice — shown when a lone cheap (single-tile)
          cart can't yet reach checkout. */}
      {belowMinimum && minimum != null && (
        <p className="mt-2 text-center text-sm text-terracotta">
          Pedido mínimo: {formatPrice(minimum)}. Agrega más piezas para continuar.
        </p>
      )}

      {/* Processor attribution — tiny support line, only when there's
          something to check out. Codex's note: name the processor for
          trust, but don't let it crowd the CTA label. */}
      {items.length > 0 && !belowMinimum && (
        <p className="mt-2 text-center text-xs text-warm-gray/80">
          {t('processorAttribution')}
        </p>
      )}

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
