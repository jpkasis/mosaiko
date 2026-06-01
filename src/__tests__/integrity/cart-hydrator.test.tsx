// @vitest-environment jsdom
/**
 * UAT-6 PR1 contract test: CartHydrator reconciliation rules.
 *
 *   - cartStatus 'gone'          → clears local cart even when non-empty
 *   - cartStatus 'active' items  → server wins (overrides local empty AND non-empty)
 *   - cartStatus 'active' empty  → local UI cache preserved
 *   - pageshow event             → triggers a fresh hydration
 *   - request-id race protection → stale responses can't overwrite newer ones
 *
 * `checkoutInProgress` is reset to false after every hydration so a stale
 * pre-redirect flag doesn't linger after the user returns from Shopify.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor, act, cleanup } from '@testing-library/react';
import React from 'react';

// jsdom in this project doesn't expose window.localStorage. Stub it before
// the cart-store import below picks it up via Zustand persist.
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
import { CartHydrator } from '@/components/cart/CartHydrator';

function makeItem(id: string): CartItem {
  return {
    id,
    name: `Item ${id}`,
    price: 100,
    quantity: 1,
    type: 'custom',
  } as CartItem;
}

beforeEach(() => {
  useCartStore.setState({
    items: [],
    isDrawerOpen: false,
    checkoutInProgress: false,
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function mockFetchOnce(body: unknown): void {
  global.fetch = vi.fn(async () =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  ) as unknown as typeof fetch;
}

describe('CartHydrator reconciliation', () => {
  test("cartStatus 'gone' clears non-empty local cart", async () => {
    useCartStore.setState({ items: [makeItem('local-1')] });
    mockFetchOnce({ items: [], cartStatus: 'gone' });

    render(<CartHydrator />);
    await waitFor(() => expect(useCartStore.getState().items).toEqual([]));
  });

  test("cartStatus 'active' + server items replaces local empty cart", async () => {
    const serverItems = [makeItem('server-1')];
    mockFetchOnce({ items: serverItems, cartStatus: 'active' });

    render(<CartHydrator />);
    await waitFor(() =>
      expect(useCartStore.getState().items.map((i) => i.id)).toEqual(['server-1']),
    );
  });

  test("cartStatus 'active' + server items replaces local non-empty cart (server wins)", async () => {
    useCartStore.setState({ items: [makeItem('local-stale')] });
    const serverItems = [makeItem('server-fresh')];
    mockFetchOnce({ items: serverItems, cartStatus: 'active' });

    render(<CartHydrator />);
    await waitFor(() =>
      expect(useCartStore.getState().items.map((i) => i.id)).toEqual(['server-fresh']),
    );
  });

  test("cartStatus 'active' + server empty preserves non-empty local cart", async () => {
    const localItems = [makeItem('local-only')];
    useCartStore.setState({ items: localItems });
    mockFetchOnce({ items: [], cartStatus: 'active' });

    render(<CartHydrator />);
    // Wait long enough for the fetch promise to settle, then assert local intact.
    await new Promise((r) => setTimeout(r, 50));
    expect(useCartStore.getState().items.map((i) => i.id)).toEqual(['local-only']);
  });

  test('pageshow event triggers a fresh hydration', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ items: [], cartStatus: 'active' }), {
        status: 200,
      }),
    ) as unknown as typeof fetch;
    global.fetch = fetchMock;

    render(<CartHydrator />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    act(() => {
      window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: false }));
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });

  test('every hydration resets checkoutInProgress to false', async () => {
    useCartStore.setState({ checkoutInProgress: true });
    mockFetchOnce({ items: [], cartStatus: 'active' });

    render(<CartHydrator />);
    await waitFor(() =>
      expect(useCartStore.getState().checkoutInProgress).toBe(false),
    );
  });

  test('failed hydration still resets checkoutInProgress to false', async () => {
    useCartStore.setState({ checkoutInProgress: true });
    global.fetch = vi.fn(async () =>
      new Response('unavailable', { status: 503 }),
    ) as unknown as typeof fetch;

    render(<CartHydrator />);
    await waitFor(() =>
      expect(useCartStore.getState().checkoutInProgress).toBe(false),
    );
  });
});
