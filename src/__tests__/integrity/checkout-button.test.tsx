// @vitest-environment jsdom
/**
 * UAT-6 PR1 contract test: CheckoutButton no longer calls clearCart().
 *
 * The cart-empty-on-checkout-back bug originated here: CheckoutButton.tsx
 * called clearCart() immediately before window.location.href = checkoutUrl,
 * which triggered the empty-sync cascade that deleted the Shopify cart
 * cookie. This test locks that the local cart survives the redirect
 * intent — the Shopify cart cookie remains; /api/cart/load on return
 * reconciles authoritatively via cartStatus.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, waitFor, screen, cleanup } from '@testing-library/react';
import React from 'react';

// jsdom doesn't expose window.localStorage in this project's setup.
function installLocalStorageStub(): void {
  const store = new Map<string, string>();
  const ls: Storage = {
    get length() {
      return store.size;
    },
    key: (i) => Array.from(store.keys())[i] ?? null,
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => {
      store.set(k, v);
    },
    removeItem: (k) => {
      store.delete(k);
    },
    clear: () => store.clear(),
  };
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: ls,
  });
}
installLocalStorageStub();

import { useCartStore, type CartItem } from '@/lib/cart-store';
import { CheckoutButton } from '@/components/cart/CheckoutButton';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, vars?: Record<string, unknown>) =>
    vars ? `${key}:${JSON.stringify(vars)}` : key,
}));

vi.mock('framer-motion', () => {
  const tag = (Component: string) => {
    const Wrapped = ({
      children,
      ...rest
    }: { children?: React.ReactNode } & Record<string, unknown>) =>
      React.createElement(Component, rest, children);
    Wrapped.displayName = `MockMotion(${Component})`;
    return Wrapped;
  };
  return {
    motion: new Proxy({}, { get: (_, tagName: string) => tag(tagName) }),
    AnimatePresence: ({ children }: { children?: React.ReactNode }) => children,
  };
});

// Priced above the $200 minimum-order floor (MINIMUM_ORDER_MXN) so the button
// is enabled — these tests exercise the redirect / re-enable behavior of a
// VALID checkout, not the below-minimum disabled state.
function makeItem(id: string): CartItem {
  return {
    id,
    name: `Item ${id}`,
    price: 300,
    quantity: 1,
    type: 'custom',
  } as CartItem;
}

const originalLocation = window.location;
let mockHref = '';

beforeEach(() => {
  useCartStore.setState({
    items: [makeItem('cart-1')],
    isDrawerOpen: false,
    checkoutInProgress: false,
  });
  mockHref = '';
  // jsdom location.href is settable but we want to intercept it.
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: new Proxy({} as Location, {
      get: (_t, prop) =>
        prop === 'href' ? mockHref : (originalLocation as unknown as Record<PropertyKey, unknown>)[prop as string],
      set: (_t, prop, value) => {
        if (prop === 'href') {
          mockHref = value as string;
          return true;
        }
        return true;
      },
    }),
  });
});

afterEach(() => {
  // Unmount between tests so `screen` doesn't see a prior render's button (the
  // redirect test intentionally leaves its button in the loading state).
  cleanup();
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: originalLocation,
  });
  vi.restoreAllMocks();
});

describe('CheckoutButton', () => {
  test('click sets checkoutInProgress=true, redirects, does NOT call clearCart', async () => {
    const clearCartSpy = vi.spyOn(useCartStore.getState(), 'clearCart');
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ checkoutUrl: 'https://shop.example/checkout/x' }), {
        status: 200,
      }),
    ) as unknown as typeof fetch;

    render(<CheckoutButton />);
    const btn = screen.getByRole('button');
    fireEvent.click(btn);

    await waitFor(() => expect(mockHref).toBe('https://shop.example/checkout/x'));

    expect(useCartStore.getState().checkoutInProgress).toBe(true);
    expect(useCartStore.getState().items).toHaveLength(1); // cart preserved
    expect(clearCartSpy).not.toHaveBeenCalled();
  });

  test('409 PRICES_CHANGED → button re-enables (not stuck), no redirect, cart preserved', async () => {
    // PR-B Codex 3rd-audit MAJOR: a price-drift 409 used to return before any
    // state reset, leaving the button stuck disabled. It must re-enable so the
    // customer can re-confirm the new total. (No PricesProvider here, so
    // refreshPrices is the context default no-op — one fetch, the 409.)
    const clearCartSpy = vi.spyOn(useCartStore.getState(), 'clearCart');
    global.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          error: 'Los precios se actualizaron.',
          code: 'PRICES_CHANGED',
          total: 480,
        }),
        { status: 409 },
      ),
    ) as unknown as typeof fetch;

    render(<CheckoutButton />);
    fireEvent.click(screen.getByRole('button'));

    await waitFor(() =>
      expect(screen.getByText('Los precios se actualizaron.')).toBeTruthy(),
    );

    expect(useCartStore.getState().checkoutInProgress).toBe(false); // not stuck
    expect((screen.getByRole('button') as HTMLButtonElement).disabled).toBe(false);
    expect(mockHref).toBe(''); // never redirected
    expect(useCartStore.getState().items).toHaveLength(1); // cart preserved
    expect(clearCartSpy).not.toHaveBeenCalled();
  });
});
