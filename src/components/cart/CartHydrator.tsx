'use client';

import { useEffect } from 'react';
import { useCartStore, type CartItem } from '@/lib/cart-store';

/**
 * On first render after Zustand persist has finished hydrating, asks the
 * server for a saved Shopify cart and pours it into the Zustand store — but
 * only if the local cart is empty. A returning user with localStorage intact
 * keeps their session; a user whose localStorage was wiped but whose
 * `mosaiko_cart_id` cookie still points at a living Shopify cart sees their
 * items reappear. Renders nothing.
 */
export function CartHydrator() {
  useEffect(() => {
    let cancelled = false;

    async function attempt() {
      if (cancelled) return;
      if (useCartStore.getState().items.length > 0) return;
      try {
        const res = await fetch('/api/cart/load', { cache: 'no-store' });
        if (!res.ok) return;
        const data = (await res.json()) as { items?: CartItem[] };
        if (cancelled) return;
        if (!Array.isArray(data.items) || data.items.length === 0) return;
        // Don't clobber if a concurrent user action populated the cart in the
        // meantime.
        if (useCartStore.getState().items.length > 0) return;
        useCartStore.setState({ items: data.items });
      } catch (error) {
        console.warn('[CartHydrator] load failed:', error);
      }
    }

    if (useCartStore.persist.hasHydrated()) {
      attempt();
    } else {
      const unsub = useCartStore.persist.onFinishHydration(() => {
        attempt();
        unsub();
      });
      return () => {
        cancelled = true;
        unsub();
      };
    }

    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}
