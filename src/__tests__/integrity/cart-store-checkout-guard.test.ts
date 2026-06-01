// @vitest-environment jsdom
/**
 * UAT-6 PR1 contract test: cart-store subscriber + pagehide guards.
 *
 * The bug source was that the subscriber's empty-transition branch fired
 * performSync([]) → POST /api/cart/save with items=[] → cookie deleted.
 * The pagehide handler had the same path. With checkoutInProgress guards
 * in both, the redirect-to-Shopify flow no longer wipes the cookie.
 *
 *   1. Empty transition while checkoutInProgress=true → NO sync fires
 *   2. pagehide while checkoutInProgress=true → NO beacon
 *   3. pagehide with empty cart → NO beacon (would be a wasted no-op POST)
 *   4. Normal non-empty mutation still syncs (regression guard)
 *   5. First add + immediate pagehide still beacons before debounce lands
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

// jsdom in this project doesn't expose window.localStorage.
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

const fetchMock = vi.fn();
const beaconMock = vi.fn();

beforeEach(() => {
  installLocalStorageStub();
  fetchMock.mockReset().mockResolvedValue(
    new Response(null, { status: 204 }),
  );
  beaconMock.mockReset().mockReturnValue(true);
  global.fetch = fetchMock as unknown as typeof fetch;
  Object.defineProperty(navigator, 'sendBeacon', {
    configurable: true,
    writable: true,
    value: beaconMock,
  });
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function loadStore(): Promise<typeof import('@/lib/cart-store').useCartStore> {
  // Fresh module so the subscriber + pagehide listener register cleanly
  // with the current `fetch` / `sendBeacon` mocks.
  const mod = await import('@/lib/cart-store');
  // Ensure the persist hydration flag is set so subscriber doesn't bail on
  // `!hasHydrated`.
  mod.useCartStore.persist.rehydrate?.();
  // Allow the post-hydration setTimeout (if any) to flush.
  await Promise.resolve();
  return mod.useCartStore;
}

function makeItem(id: string) {
  return {
    id,
    name: `Item ${id}`,
    price: 100,
    quantity: 1,
    type: 'custom' as const,
  };
}

describe('cart-store subscriber + pagehide guards', () => {
  test('1. Empty transition during checkoutInProgress=true does NOT sync', async () => {
    const useCartStore = await loadStore();
    useCartStore.setState({ items: [makeItem('a') as never] });
    // Now flip checkoutInProgress
    useCartStore.setState({ checkoutInProgress: true });
    fetchMock.mockClear();
    // Transition to empty
    useCartStore.setState({ items: [] });
    // Allow subscriber to fire
    await new Promise((r) => setTimeout(r, 50));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('2. pagehide during checkoutInProgress=true does NOT beacon', async () => {
    const useCartStore = await loadStore();
    useCartStore.setState({
      items: [makeItem('a') as never],
      checkoutInProgress: true,
    });
    beaconMock.mockClear();
    window.dispatchEvent(new Event('pagehide'));
    expect(beaconMock).not.toHaveBeenCalled();
  });

  test('3. pagehide with empty cart does NOT beacon', async () => {
    const useCartStore = await loadStore();
    useCartStore.setState({ items: [], checkoutInProgress: false });
    beaconMock.mockClear();
    window.dispatchEvent(new Event('pagehide'));
    expect(beaconMock).not.toHaveBeenCalled();
  });

  test('4. Normal non-empty mutation still syncs (no regression)', async () => {
    const useCartStore = await loadStore();
    useCartStore.setState({ items: [], checkoutInProgress: false });
    fetchMock.mockClear();
    // Add an item — triggers debounced scheduleSync
    useCartStore.setState({ items: [makeItem('new-item') as never] });
    // Default debounce is 800ms; advance plenty
    await new Promise((r) => setTimeout(r, 900));
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/cart/save',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  test('5. First non-empty mutation flushes on pagehide before debounce lands', async () => {
    const useCartStore = await loadStore();
    useCartStore.setState({ items: [], checkoutInProgress: false });
    fetchMock.mockClear();
    beaconMock.mockClear();

    useCartStore.setState({ items: [makeItem('first-item') as never] });
    window.dispatchEvent(new Event('pagehide'));

    expect(beaconMock).toHaveBeenCalledWith(
      '/api/cart/save',
      expect.any(Blob),
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
