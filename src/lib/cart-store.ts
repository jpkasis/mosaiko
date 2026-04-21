import { create } from 'zustand';
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware';
import type { GridSize } from './grid-config';
import type { CategoryType, TonosIntensity } from './customization-types';

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
    tonosSlots?: [
      { fitMode: 'fill' | 'fit' | 'stretch'; rotation: 0 | 90 | 180 | 270 },
      { fitMode: 'fill' | 'fit' | 'stretch'; rotation: 0 | 90 | 180 | 270 },
      { fitMode: 'fill' | 'fit' | 'stretch'; rotation: 0 | 90 | 180 | 270 },
    ];
    layoutRotated?: boolean;
    /**
     * R2 key + URL of the canonical composite image produced at add-to-cart.
     * Kept alongside the photo metadata so the Shopify webhook can skip
     * re-rendering at order time by splitting the same composite.
     */
    compositeJobId?: string;
    compositeKey?: string;
    compositeUrl?: string;
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
