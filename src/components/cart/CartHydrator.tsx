'use client';

import { useEffect } from 'react';
import { useCartStore, type CartItem } from '@/lib/cart-store';

type CartLoadResponse = {
  items: CartItem[];
  cartStatus: 'active' | 'gone';
};

/**
 * Hydrates the Zustand cart from /api/cart/load, which queries Shopify for
 * the current cart state. Runs on mount AND on every `pageshow` event so we
 * also reconcile when the user returns via bfcache (e.g. browser back from
 * Shopify checkout).
 *
 * Reconciliation rules (Shopify cart is source of truth):
 *   - cartStatus === 'gone'        → always clear local cart (converted/expired)
 *   - cartStatus === 'active' + items → server wins (overrides local)
 *   - cartStatus === 'active' + empty → keep local UI cache as-is
 *
 * Race protection: a per-request id (module-scoped) tracks the latest call.
 * Stale responses from an earlier hydration are discarded if a newer one
 * was kicked off (e.g. pageshow during a slow mount fetch).
 *
 * Also always resets `checkoutInProgress` to false after every hydration —
 * the flag is in-memory only (not persisted), but bfcache restore brings
 * back the live Zustand store including any lingering true value from
 * before the redirect.
 *
 * Renders nothing.
 */
let hydrationRequestId = 0;

function resetCheckoutForLatestHydration(requestId: number): void {
  if (requestId === hydrationRequestId) {
    useCartStore.getState().setCheckoutInProgress(false);
  }
}

async function hydrateCartFromServer(): Promise<void> {
  const requestId = ++hydrationRequestId;

  let data: CartLoadResponse | null = null;
  try {
    const res = await fetch('/api/cart/load', { cache: 'no-store' });
    if (!res.ok) {
      resetCheckoutForLatestHydration(requestId);
      return;
    }
    data = (await res.json()) as CartLoadResponse;
  } catch (error) {
    console.warn('[CartHydrator] load failed:', error);
    resetCheckoutForLatestHydration(requestId);
    return;
  }

  // A newer hydration was kicked off while we were awaiting. Bail.
  if (requestId !== hydrationRequestId) return;
  const state = useCartStore.getState();
  if (!data || !Array.isArray(data.items)) {
    state.setCheckoutInProgress(false);
    return;
  }

  if (data.cartStatus === 'gone') {
    state.clearCart();
    state.setCheckoutInProgress(false);
    return;
  }

  if (data.items.length > 0) {
    useCartStore.setState({ items: data.items });
    state.setCheckoutInProgress(false);
    return;
  }

  // active + server empty: keep local UI cache as-is.
  state.setCheckoutInProgress(false);
}

export function CartHydrator() {
  useEffect(() => {
    let unsub: (() => void) | null = null;

    if (useCartStore.persist.hasHydrated()) {
      void hydrateCartFromServer();
    } else {
      unsub = useCartStore.persist.onFinishHydration(() => {
        void hydrateCartFromServer();
      });
    }

    function onPageShow(event: PageTransitionEvent): void {
      // Fire on every pageshow — bfcache restore (event.persisted=true) AND
      // normal navigations both benefit from reconciling against Shopify.
      // The request-id guard above prevents stale responses from clobbering
      // newer ones if a mount fetch is still in flight.
      void hydrateCartFromServer();
      // Touch the event so the unused-variable lint doesn't fire if we
      // later decide to branch on event.persisted.
      void event;
    }

    window.addEventListener('pageshow', onPageShow);
    return () => {
      if (unsub) unsub();
      window.removeEventListener('pageshow', onPageShow);
    };
  }, []);

  return null;
}
