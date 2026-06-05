import type { CartItem } from '../cart-store';
import type { GridSize } from '../grid-config';
import {
  STD_DEFAULTS,
  type CategoryCustomization,
  type CategoryType,
  type TonosIntensity,
  type TonosSlotConfigs,
  type ImageRotation,
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
  tonosSlots?: TonosSlotConfigs;
  /**
   * Mosaicos-only. When true, rows/cols swap at the print processor so
   * the printed tile arrangement matches the rotated builder preview.
   * Forwarded through `buildPrintCustomization` into the
   * `MosaicosCustomization` discriminated-union variant.
   */
  layoutRotated?: boolean;
  /**
   * UAT-6 PR5: 90° photo rotation for single-image categories. Forwarded
   * into the discriminated-union variant's `imageRotation` field (emitted
   * only when nonzero). Ignored for Tonos (per-slot rotation lives in
   * `tonosSlots`).
   */
  imageRotation?: ImageRotation;
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
    layoutRotated: c.layoutRotated,
    imageRotation: c.imageRotation,
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
  // UAT-6 PR5: emit imageRotation only when nonzero (0 is falsy → omitted),
  // matching the "absent === 0" reading convention in the print processor.
  const rot = input.imageRotation ? { imageRotation: input.imageRotation } : {};

  switch (categoryType) {
    case 'mosaicos':
      return {
        categoryType: 'mosaicos',
        gridSize: gridSize as 1 | 3 | 6 | 9,
        // Only emit the field when truthy — keeps JSON diffs small and
        // matches the "absent === false" reading convention in the
        // print processor.
        ...(input.layoutRotated ? { layoutRotated: true } : {}),
        ...rot,
      };

    case 'spotify':
      return {
        categoryType: 'spotify',
        gridSize: 6,
        songName: tf.songName ?? '',
        artistName: tf.artistName ?? '',
        ...rot,
      };

    case 'arte':
      return {
        categoryType: 'arte',
        gridSize: 9,
        title: tf.title ?? '',
        artist: tf.artist ?? '',
        year: tf.year ?? '',
        ...rot,
      };

    case 'studio':
      return {
        categoryType: 'studio',
        gridSize: 6,
        year: tf.year ?? '',
        japaneseText: tf.japaneseText ?? '',
        customText: tf.customText ?? '',
        studioText: tf.studioText ?? '',
        ...rot,
      };

    case 'save-the-date': {
      // UAT-1b: STD supports 9/6/3 grids. Preserve the incoming gridSize
      // instead of forcing 9. Default to 9 if an unsupported size sneaks
      // through (shouldn't happen — useBuilderFlow + checkout guard both
      // validate against allowedGridSizes upstream).
      const stdGrid = (gridSize === 6 ? 6 : gridSize === 3 ? 3 : 9) as 3 | 6 | 9;
      return {
        categoryType: 'save-the-date',
        gridSize: stdGrid,
        eventText: tf.eventText ?? '',
        date: tf.date ?? '',
        fontFamily: (tf.fontFamily as STDFontFamily) || STD_DEFAULTS.fontFamily,
        fontSize: (tf.fontSize as STDSize) || STD_DEFAULTS.fontSize,
        color: tf.color || STD_DEFAULTS.color,
        anchor: (tf.anchor as STDAnchor) || STD_DEFAULTS.anchor,
        treatment: (tf.treatment as STDTextTreatment) || STD_DEFAULTS.treatment,
        intensity: (tf.intensity as STDTextIntensity) || STD_DEFAULTS.intensity,
        ...(input.layoutRotated ? { layoutRotated: true } : {}),
        // STD-6/9 are single-photo (rotation applies); STD-3 is multi-photo
        // and its processor branch ignores imageRotation (PR5 scope).
        ...rot,
      };
    }

    case 'tonos': {
      // `tonosSlots` is now declared on `TonosCustomization` so the
      // unsafe `as unknown as CategoryCustomization` cast (Phase 2 of
      // the integrity audit) is gone. Each slot carries both
      // `fitMode` and `rotation`; the webhook whitelists both via
      // `whitelistTonosFitModes` / `whitelistTonosRotations` and
      // forwards them into the print job.
      return {
        categoryType: 'tonos' as const,
        gridSize: (gridSize === 9 ? 9 : 3) as 3 | 9,
        intensity: input.tonosIntensity ?? 'medium',
        ...(input.tonosSlots ? { tonosSlots: input.tonosSlots } : {}),
      };
    }

    case 'polaroid':
      return {
        categoryType: 'polaroid',
        gridSize: 4,
        ...rot,
      };
  }
}
