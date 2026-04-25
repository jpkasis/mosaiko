import { create } from 'zustand';
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware';
import type { GridSize } from './grid-config';
import type {
  CategoryType,
  TonosIntensity,
  TonosSlotConfigs,
} from './customization-types';

export interface CartItem {
  id: string;
  type: 'custom' | 'predesigned';
  name: string;
  gridSize: GridSize;
  gridLayout: { rows: number; cols: number };
  price: number;
  quantity: number;
  /**
   * Thumbnail shown in the cart. For custom items this is the R2 URL of a
   * downscaled JPEG produced by /api/cart-composite — the canonical
   * category-aware composite. For predesigned items it's the catalog image.
   */
  previewUrl: string;
  tileUrls: string[];
  // For predesigned products
  productId?: string;
  categorySlug?: string;
  // Per-category customization snapshot
  customizations?: {
    categoryType: CategoryType;
    textFields?: Record<string, string>;
    // Single-image categories
    photoStorageUrl?: string;
    cropArea?: { x: number; y: number; width: number; height: number };
    // Tonos (multi-image)
    photoStorageUrls?: [string, string, string];
    cropAreas?: [
      { x: number; y: number; width: number; height: number },
      { x: number; y: number; width: number; height: number },
      { x: number; y: number; width: number; height: number },
    ];
    tonosIntensity?: TonosIntensity;
    tonosSlots?: TonosSlotConfigs;
    layoutRotated?: boolean;
    /**
     * R2 key + URL of the canonical composite image produced at add-to-cart.
     * Kept alongside the photo metadata so the Shopify webhook can skip
     * re-rendering at order time by splitting the same composite.
     */
    compositeJobId?: string;
    compositeKey?: string;
    compositeUrl?: string;
    /**
     * Pipeline version at the moment the composite was created. Stamped
     * by `/api/cart-composite` on the response and persisted here so the
     * webhook's composite-reuse bypass can verify the composite still
     * matches the current renderer at order time. A cart item created
     * before a pipeline deploy and checked out after would otherwise
     * carry a stale composite that bypasses the renderer change. Per
     * Codex Phase 3 audit MAJOR.
     */
    compositePipelineVersion?: string;
  };
}

interface CartState {
  items: CartItem[];
  isDrawerOpen: boolean;
  checkoutInProgress: boolean;
  addItem: (item: Omit<CartItem, 'id'>) => void;
  removeItem: (id: string) => void;
  updateQuantity: (id: string, quantity: number) => void;
  clearCart: () => void;
  openDrawer: () => void;
  closeDrawer: () => void;
  toggleDrawer: () => void;
  setCheckoutInProgress: (inProgress: boolean) => void;
}

/**
 * Rejects cart items that would push base64 data URLs into localStorage. A
 * persisted multi-MB `data:image/...` in `previewUrl` or `compositeUrl`
 * overflows the browser quota after a few adds and bricks every subsequent
 * store mutation. The server's /api/cart-composite route is responsible for
 * always returning real URLs (R2 or the /api/cart-composite/blob/ fallback).
 */
function assertNoDataUrls(item: Omit<CartItem, 'id'>): void {
  const check = (value: string | undefined, field: string) => {
    if (value && value.startsWith('data:')) {
      throw new Error(
        `cart-store: refusing to persist base64 data URL in field "${field}"`,
      );
    }
  };
  check(item.previewUrl, 'previewUrl');
  item.tileUrls?.forEach((u, i) => check(u, `tileUrls[${i}]`));
  const c = item.customizations;
  if (c) {
    check(c.compositeUrl, 'customizations.compositeUrl');
    check(c.photoStorageUrl, 'customizations.photoStorageUrl');
    c.photoStorageUrls?.forEach((u, i) =>
      check(u, `customizations.photoStorageUrls[${i}]`),
    );
  }
}

function isQuotaError(e: unknown): boolean {
  if (!(e instanceof Error)) return false;
  if (e.name === 'QuotaExceededError') return true;
  const code = (e as DOMException).code;
  return code === 22 || code === 1014; // Firefox legacy + NS_ERROR_DOM_QUOTA_REACHED
}

// Guards against infinite recursion when the recovery path's clearCart()
// triggers another setItem. Module-scope latch is enough — Zustand's set is
// synchronous within a single tick.
let isRecovering = false;

const safeLocalStorage: StateStorage = {
  getItem(name) {
    if (typeof window === 'undefined') return null;
    try {
      return window.localStorage.getItem(name);
    } catch {
      return null;
    }
  },
  setItem(name, value) {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(name, value);
    } catch (e) {
      if (!isQuotaError(e) || isRecovering) throw e;
      isRecovering = true;
      try {
        console.warn('[cart-store] localStorage quota exceeded — clearing cart');
        window.localStorage.removeItem(name);
        // Re-entrant setItem from this set() call persists {items: []} —
        // small payload, succeeds, and isRecovering short-circuits any
        // residual failure path.
        useCartStore.getState().clearCart();
      } finally {
        isRecovering = false;
      }
    }
  },
  removeItem(name) {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.removeItem(name);
    } catch {
      // ignore
    }
  },
};

export const useCartStore = create<CartState>()(
  persist(
    (set) => ({
      items: [],
      isDrawerOpen: false,
      checkoutInProgress: false,

      addItem: (item) => {
        assertNoDataUrls(item);
        set((state) => ({
          items: [
            ...state.items,
            { ...item, id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}` },
          ],
          isDrawerOpen: true,
        }));
      },

      removeItem: (id) =>
        set((state) => ({
          items: state.items.filter((item) => item.id !== id),
        })),

      updateQuantity: (id, quantity) =>
        set((state) => ({
          items: state.items.map((item) =>
            item.id === id ? { ...item, quantity: Math.max(1, quantity) } : item,
          ),
        })),

      clearCart: () => set({ items: [] }),

      openDrawer: () => set({ isDrawerOpen: true }),
      closeDrawer: () => set({ isDrawerOpen: false }),
      toggleDrawer: () => set((state) => ({ isDrawerOpen: !state.isDrawerOpen })),
      setCheckoutInProgress: (inProgress) => set({ checkoutInProgress: inProgress }),
    }),
    {
      name: 'mosaiko-cart',
      storage: createJSONStorage(() => safeLocalStorage),
      partialize: (state) => ({ items: state.items }),
    },
  ),
);

// Derived selectors
export const selectCartTotal = (state: CartState) =>
  state.items.reduce((sum, item) => sum + item.price * item.quantity, 0);

export const selectCartCount = (state: CartState) =>
  state.items.reduce((sum, item) => sum + item.quantity, 0);

// ─── Shopify-backed durability ──────────────────────────────────────────────
// Mirrors the Zustand cart to an anonymous Shopify cart on every mutation so
// the user can close the tab, clear localStorage, or come back within
// Shopify's ~10-day cart retention and have their custom items restored.
// Debounced to coalesce rapid edits (quantity stepper, multi-add sequences).

if (typeof window !== 'undefined') {
  const SYNC_DEBOUNCE_MS = 800;
  const SAVE_ENDPOINT = '/api/cart/save';

  let pendingSync: ReturnType<typeof setTimeout> | null = null;
  let lastSyncedItems: CartItem[] | null = null;
  // Codex Phase 3 audit MAJOR fix (in-flight race): an older non-empty
  // save could still be in-flight when the user clears the cart and
  // checks out. Without aborting, the older response could complete
  // AFTER the empty save and re-create the `mosaiko_cart_id` cookie —
  // resurrecting the just-checked-out cart. AbortController + "newest
  // wins" policy: every new performSync aborts whatever's in flight.
  let inFlightAbort: AbortController | null = null;
  // Tracks whether we've ever fired a performSync this session. The
  // pagehide handler uses this to distinguish "initial load with empty
  // cart, never synced" (skip beacon) from "user did something then
  // navigated away" (always flush — including empty, including the
  // case where the immediate-fire empty failed/was dropped).
  let hasEverSynced = false;

  let hasHydrated = useCartStore.persist.hasHydrated();
  useCartStore.persist.onFinishHydration(() => {
    hasHydrated = true;
  });

  function performSync(items: CartItem[]) {
    // POST every change — including the non-empty → empty transition,
    // because /api/cart/save needs to clear `mosaiko_cart_id` so the
    // Shopify-backed prior cart can't resurrect on next page load
    // (Phase 3.3 empty-cart resurrect fix). Initial-load empty state
    // is not a concern: subscribes are gated on `hasHydrated` and only
    // fire after Zustand persist finishes, so the first POST we ever
    // send reflects an actual user action, not a hydration default.
    if (inFlightAbort) {
      inFlightAbort.abort();
    }
    const ctrl = new AbortController();
    inFlightAbort = ctrl;
    hasEverSynced = true;
    fetch(SAVE_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items }),
      keepalive: true,
      signal: ctrl.signal,
    })
      .then((r) => {
        // Only update `lastSyncedItems` on successful response. A failed
        // save should NOT suppress the next retry — Codex flagged that
        // marking before-await leaves stale items[] looking synced.
        if (r.ok || r.status === 204) {
          lastSyncedItems = items;
        } else {
          console.warn('[cart-store] sync responded', r.status);
        }
        if (inFlightAbort === ctrl) inFlightAbort = null;
      })
      .catch((e) => {
        // AbortError is expected when a newer sync supersedes us.
        if (!(e instanceof Error) || e.name !== 'AbortError') {
          console.warn('[cart-store] sync failed:', e);
        }
        if (inFlightAbort === ctrl) inFlightAbort = null;
      });
  }

  function scheduleSync(items: CartItem[]) {
    if (items === lastSyncedItems) return;
    if (pendingSync) clearTimeout(pendingSync);
    pendingSync = setTimeout(() => {
      pendingSync = null;
      performSync(items);
    }, SYNC_DEBOUNCE_MS);
  }

  useCartStore.subscribe((state, prev) => {
    if (!hasHydrated) return;
    if (state.items === prev.items) return;
    // Transition to empty (clearCart, last-item-removed, post-checkout
    // wipe): bypass debounce so the empty save races ahead of any
    // pending non-empty timer. `performSync` aborts any in-flight
    // request as well, so an older non-empty fetch can't re-set the
    // cookie after the empty save lands.
    if (state.items.length === 0 && prev.items.length > 0) {
      if (pendingSync) {
        clearTimeout(pendingSync);
        pendingSync = null;
      }
      performSync(state.items);
      return;
    }
    scheduleSync(state.items);
  });

  // Best-effort flush on tab close — sendBeacon is fire-and-forget and
  // completes after the page is gone, so the pending debounce still lands.
  //
  // Codex Phase 3 audit (round 3) MAJOR fix: the prior `!hadPendingSync`
  // guard skipped the beacon for the checkout flow because the empty
  // transition fires `performSync([])` immediately (no debounce, no
  // pendingSync). If that keepalive empty fetch was dropped or failed,
  // pagehide skipped the beacon → cookie survived → CartHydrator
  // resurrected the just-checked-out cart. Replace with a `hasEverSynced`
  // gate: we always flush on pagehide as long as the current items
  // differ from the last successful sync AND we've ever synced this
  // session (otherwise initial-load empty would spuriously delete).
  window.addEventListener('pagehide', () => {
    if (pendingSync) {
      clearTimeout(pendingSync);
      pendingSync = null;
    }
    const items = useCartStore.getState().items;
    // Skip only when we've never synced AND the cart is empty —
    // i.e. initial-load empty, no user action, no in-flight state to
    // flush. If the user added their first item but left within the
    // 800ms debounce, we MUST still flush (otherwise their first add
    // never reaches Shopify). Codex Phase 3 round-4 fix.
    if (!hasEverSynced && items.length === 0) return;
    // Already up-to-date with the last successful sync. Skip.
    if (items === lastSyncedItems) return;
    if (typeof navigator === 'undefined' || !navigator.sendBeacon) return;
    const blob = new Blob([JSON.stringify({ items })], {
      type: 'application/json',
    });
    navigator.sendBeacon(SAVE_ENDPOINT, blob);
  });
}
