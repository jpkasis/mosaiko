import type { CartItem } from '../cart-store';
import type { GridSize } from '../grid-config';
import {
  STD_DEFAULTS,
  type CategoryCustomization,
  type CategoryType,
  type TonosIntensity,
  type STDFontFamily,
  type STDSize,
  type STDAnchor,
  type STDTextTreatment,
  type STDTextIntensity,
} from '../customization-types';

/**
 * Translate a cart item's in-memory `customizations` shape into the
 * `CategoryCustomization` discriminated union the print pipeline expects.
 *
 * The cart keeps text fields nested under `textFields: Record<string, string>`
 * for UI flexibility, but the server-side processors in
 * `src/lib/print-pipeline/processors/*` read flat, typed, top-level
 * fields (e.g. `c.eventText`, `c.songName`, `c.title`, `c.intensity`).
 *
 * Additionally, `gridSize` is stored at the CartItem root, not inside
 * `customizations`, so we lift it into the output here.
 *
 * For Save the Date specifically, user controls that weren't touched
 * never land in `textFields`; merge in `STD_DEFAULTS` so the printed
 * magnet always has a complete, typed configuration.
 */
/**
 * Shape accepted by `buildPrintCustomization` — a narrower subset of the
 * builder's in-memory flow state. Lets the pre-cart path build a
 * `CategoryCustomization` for /api/cart-composite without having to
 * construct a fake CartItem.
 */
export interface PrintCustomizationInput {
  categoryType: CategoryType;
  gridSize: GridSize;
  textFields?: Record<string, string>;
  tonosIntensity?: TonosIntensity;
  tonosSlots?: CartItem['customizations'] extends infer T
    ? T extends { tonosSlots?: infer S } ? S : never
    : never;
}

export function toPrintCustomization(item: CartItem): CategoryCustomization {
  const c = item.customizations;
  if (!c) {
    throw new Error('toPrintCustomization called on cart item without customizations');
  }
  return buildPrintCustomization({
    categoryType: c.categoryType,
    gridSize: item.gridSize,
    textFields: c.textFields,
    tonosIntensity: c.tonosIntensity,
    tonosSlots: c.tonosSlots,
  });
}

/**
 * Produces a flat, typed `CategoryCustomization` discriminated union from
 * the builder's customization input. Used at add-to-cart time (to call
 * /api/cart-composite) and at checkout time (to serialize into Shopify
 * line-item attributes). One translation boundary, zero divergence.
 */
export function buildPrintCustomization(
  input: PrintCustomizationInput,
): CategoryCustomization {
  const { categoryType, gridSize } = input;
  const tf = input.textFields ?? {};

  switch (categoryType) {
    case 'mosaicos':
      return {
        categoryType: 'mosaicos',
        gridSize: gridSize as 3 | 6 | 9,
      };

    case 'spotify':
      return {
        categoryType: 'spotify',
        gridSize: 6,
        songName: tf.songName ?? '',
        artistName: tf.artistName ?? '',
      };

    case 'arte':
      return {
        categoryType: 'arte',
        gridSize: 9,
        title: tf.title ?? '',
        artist: tf.artist ?? '',
        year: tf.year ?? '',
      };

    case 'studio':
      return {
        categoryType: 'studio',
        gridSize: 6,
        year: tf.year ?? '',
        japaneseText: tf.japaneseText ?? '',
        customText: tf.customText ?? '',
        studioText: tf.studioText ?? '',
      };

    case 'save-the-date':
      return {
        categoryType: 'save-the-date',
        gridSize: 9,
        eventText: tf.eventText ?? '',
        date: tf.date ?? '',
        fontFamily: (tf.fontFamily as STDFontFamily) || STD_DEFAULTS.fontFamily,
        fontSize: (tf.fontSize as STDSize) || STD_DEFAULTS.fontSize,
        color: tf.color || STD_DEFAULTS.color,
        anchor: (tf.anchor as STDAnchor) || STD_DEFAULTS.anchor,
        treatment: (tf.treatment as STDTextTreatment) || STD_DEFAULTS.treatment,
        intensity: (tf.intensity as STDTextIntensity) || STD_DEFAULTS.intensity,
      };

    case 'tonos': {
      const base = {
        categoryType: 'tonos' as const,
        gridSize: (gridSize === 9 ? 9 : 3) as 3 | 9,
        intensity: input.tonosIntensity ?? 'medium',
      };
      // tonosSlots carries per-slot rotations; the webhook reads them to
      // forward into the Tonos processor. Keep them alongside the union
      // shape (cast because CategoryCustomization doesn't declare them).
      if (input.tonosSlots) {
        return {
          ...base,
          tonosSlots: input.tonosSlots,
        } as unknown as CategoryCustomization;
      }
      return base;
    }

    case 'polaroid':
      return {
        categoryType: 'polaroid',
        gridSize: 4,
      };
  }
}
