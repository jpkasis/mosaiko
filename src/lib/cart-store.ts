import { create } from 'zustand';
import { persist } from 'zustand/middleware';
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
    layoutRotated?: boolean;
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

export const useCartStore = create<CartState>()(
  persist(
    (set) => ({
      items: [],
      isDrawerOpen: false,
      checkoutInProgress: false,

      addItem: (item) =>
        set((state) => ({
          items: [
            ...state.items,
            { ...item, id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}` },
          ],
          isDrawerOpen: true,
        })),

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
      partialize: (state) => ({ items: state.items }),
    },
  ),
);

// Derived selectors
export const selectCartTotal = (state: CartState) =>
  state.items.reduce((sum, item) => sum + item.price * item.quantity, 0);

export const selectCartCount = (state: CartState) =>
  state.items.reduce((sum, item) => sum + item.quantity, 0);
