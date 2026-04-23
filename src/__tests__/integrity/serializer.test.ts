/**
 * Integrity test: customization serializer round-trip
 *
 * Proves that every piece of user-designed data survives the
 * `buildPrintCustomization` / `toPrintCustomization` boundary — the
 * single translation layer between the cart's in-memory shape and the
 * `CategoryCustomization` discriminated union the print pipeline +
 * Shopify cart attribute JSON both consume.
 *
 * Failures here mean customization fields are being silently dropped at
 * the moment the builder hands off to checkout. Two flagged gaps become
 * explicit TEST.TODO entries below so the suite surfaces them without
 * going red on CI:
 *   - Tonos `fitMode` is stored but not honored by the processor.
 *   - `layoutRotated` is stored but never reaches the serializer.
 *
 * Everything else round-trips cleanly.
 */
import { describe, test, expect } from 'vitest';
import {
  buildPrintCustomization,
  toPrintCustomization,
  type PrintCustomizationInput,
} from '@/lib/shopify/customization-serializer';
import type { CartItem } from '@/lib/cart-store';
import { STD_DEFAULTS } from '@/lib/customization-types';

function roundTripJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

describe('buildPrintCustomization — per-category field retention', () => {
  test('mosaicos — minimal; gridSize only', () => {
    const result = buildPrintCustomization({
      categoryType: 'mosaicos',
      gridSize: 9,
    });
    expect(result).toEqual({ categoryType: 'mosaicos', gridSize: 9 });
    expect(roundTripJson(result)).toEqual(result);
  });

  test('spotify — songName + artistName preserved verbatim', () => {
    const result = buildPrintCustomization({
      categoryType: 'spotify',
      gridSize: 6,
      textFields: { songName: 'Cucurrucucú paloma', artistName: 'Caetano Veloso' },
    });
    expect(result).toEqual({
      categoryType: 'spotify',
      gridSize: 6,
      songName: 'Cucurrucucú paloma',
      artistName: 'Caetano Veloso',
    });
    expect(roundTripJson(result)).toEqual(result);
  });

  test('spotify — missing fields default to empty string, not undefined', () => {
    const result = buildPrintCustomization({
      categoryType: 'spotify',
      gridSize: 6,
    });
    expect(result).toEqual({
      categoryType: 'spotify',
      gridSize: 6,
      songName: '',
      artistName: '',
    });
  });

  test('arte — title, artist, year all preserved', () => {
    const result = buildPrintCustomization({
      categoryType: 'arte',
      gridSize: 9,
      textFields: { title: 'La Mona Lisa', artist: 'Leonardo da Vinci', year: '1503' },
    });
    expect(result).toEqual({
      categoryType: 'arte',
      gridSize: 9,
      title: 'La Mona Lisa',
      artist: 'Leonardo da Vinci',
      year: '1503',
    });
    expect(roundTripJson(result)).toEqual(result);
  });

  test('studio — all 4 text fields preserved; CJK survives JSON', () => {
    const result = buildPrintCustomization({
      categoryType: 'studio',
      gridSize: 6,
      textFields: {
        year: '2001',
        japaneseText: '千と千尋の神隠し',
        customText: 'EL VIAJE DE CHIHIRO',
        studioText: 'STUDIO GHIBLI',
      },
    });
    expect(result).toEqual({
      categoryType: 'studio',
      gridSize: 6,
      year: '2001',
      japaneseText: '千と千尋の神隠し',
      customText: 'EL VIAJE DE CHIHIRO',
      studioText: 'STUDIO GHIBLI',
    });
    // Critical: the CJK text must survive JSON string round-trip byte-for-byte.
    expect(roundTripJson(result)).toEqual(result);
  });

  test('save-the-date — all 8 effect knobs preserved; missing ones default via STD_DEFAULTS', () => {
    const result = buildPrintCustomization({
      categoryType: 'save-the-date',
      gridSize: 9,
      textFields: {
        eventText: 'Save the Date\n15 de junio',
        date: '2026-06-15',
        fontFamily: 'great-vibes',
        fontSize: 'L',
        color: '#FF0000',
        anchor: 'bottom-center',
        treatment: 'halo',
        intensity: 'intense',
      },
    });
    expect(result).toMatchObject({
      categoryType: 'save-the-date',
      gridSize: 9,
      eventText: 'Save the Date\n15 de junio',
      date: '2026-06-15',
      fontFamily: 'great-vibes',
      fontSize: 'L',
      color: '#FF0000',
      anchor: 'bottom-center',
      treatment: 'halo',
      intensity: 'intense',
    });
    expect(roundTripJson(result)).toEqual(result);
  });

  test('save-the-date — undefined fields fall back to STD_DEFAULTS', () => {
    const result = buildPrintCustomization({
      categoryType: 'save-the-date',
      gridSize: 9,
      textFields: {},
    }) as unknown as { [k: string]: unknown };
    expect(result.fontFamily).toBe(STD_DEFAULTS.fontFamily);
    expect(result.fontSize).toBe(STD_DEFAULTS.fontSize);
    expect(result.color).toBe(STD_DEFAULTS.color);
    expect(result.anchor).toBe(STD_DEFAULTS.anchor);
    expect(result.treatment).toBe(STD_DEFAULTS.treatment);
    expect(result.intensity).toBe(STD_DEFAULTS.intensity);
  });

  test('tonos — intensity + gridSize preserved (without slots)', () => {
    const result = buildPrintCustomization({
      categoryType: 'tonos',
      gridSize: 9,
      tonosIntensity: 'strong',
    });
    expect(result).toEqual({
      categoryType: 'tonos',
      gridSize: 9,
      intensity: 'strong',
    });
  });

  test('tonos — tonosSlots with rotation survives JSON round-trip', () => {
    const slots: NonNullable<CartItem['customizations']>['tonosSlots'] = [
      { fitMode: 'fill', rotation: 0 },
      { fitMode: 'fit', rotation: 90 },
      { fitMode: 'stretch', rotation: 270 },
    ];
    const result = buildPrintCustomization({
      categoryType: 'tonos',
      gridSize: 9,
      tonosIntensity: 'medium',
      tonosSlots: slots,
    }) as unknown as { tonosSlots: typeof slots };
    expect(result.tonosSlots).toEqual(slots);
    // JSON must preserve both rotation AND fitMode — even though the
    // current webhook only reads rotation. If fitMode drops at this
    // layer, the 'Tonos fitMode unused' defect becomes much worse.
    const round = roundTripJson(result);
    expect(round.tonosSlots).toEqual(slots);
  });

  test('polaroid — minimal', () => {
    const result = buildPrintCustomization({
      categoryType: 'polaroid',
      gridSize: 4,
    });
    expect(result).toEqual({ categoryType: 'polaroid', gridSize: 4 });
    expect(roundTripJson(result)).toEqual(result);
  });
});

describe('toPrintCustomization — CartItem → CategoryCustomization', () => {
  const baseItem = (
    type: 'custom',
    gridSize: 3 | 4 | 6 | 9,
    customizations: NonNullable<CartItem['customizations']>,
  ): CartItem => ({
    id: `item-${gridSize}`,
    type,
    gridSize,
    gridLayout: { rows: 3, cols: 3 },
    name: 'test',
    price: 480,
    quantity: 1,
    previewUrl: '',
    tileUrls: [],
    customizations,
  });

  test('spotify cart item → serializer output matches builder hand-off', () => {
    const item = baseItem('custom', 6, {
      categoryType: 'spotify',
      textFields: { songName: 'Besos', artistName: 'Paty Cantú' },
    });
    expect(toPrintCustomization(item)).toEqual({
      categoryType: 'spotify',
      gridSize: 6,
      songName: 'Besos',
      artistName: 'Paty Cantú',
    });
  });

  test('throws when customizations are missing', () => {
    const item = baseItem('custom', 9, { categoryType: 'mosaicos' });
    item.customizations = undefined;
    expect(() => toPrintCustomization(item)).toThrow(/without customizations/i);
  });

  test('tonos cart item → serializer forwards tonosSlots', () => {
    const slots: NonNullable<CartItem['customizations']>['tonosSlots'] = [
      { fitMode: 'fill', rotation: 0 },
      { fitMode: 'fill', rotation: 90 },
      { fitMode: 'fill', rotation: 180 },
    ];
    const item = baseItem('custom', 9, {
      categoryType: 'tonos',
      tonosIntensity: 'mild',
      tonosSlots: slots,
    });
    const out = toPrintCustomization(item) as unknown as {
      tonosSlots: typeof slots;
      intensity: string;
    };
    expect(out.intensity).toBe('mild');
    expect(out.tonosSlots).toEqual(slots);
  });
});

describe('mosaicos — layoutRotated round-trip (FIXED, was BLOCKER)', () => {
  test('buildPrintCustomization forwards layoutRotated: true into the mosaicos variant', () => {
    const result = buildPrintCustomization({
      categoryType: 'mosaicos',
      gridSize: 6,
      layoutRotated: true,
    });
    expect(result).toEqual({
      categoryType: 'mosaicos',
      gridSize: 6,
      layoutRotated: true,
    });
  });

  test('absent / false layoutRotated → field omitted (keeps JSON payload minimal)', () => {
    const r1 = buildPrintCustomization({ categoryType: 'mosaicos', gridSize: 9 });
    const r2 = buildPrintCustomization({
      categoryType: 'mosaicos',
      gridSize: 9,
      layoutRotated: false,
    });
    expect(r1).toEqual({ categoryType: 'mosaicos', gridSize: 9 });
    expect(r2).toEqual({ categoryType: 'mosaicos', gridSize: 9 });
    expect('layoutRotated' in r1).toBe(false);
    expect('layoutRotated' in r2).toBe(false);
  });

  test('toPrintCustomization lifts layoutRotated from CartItem customizations', () => {
    const item: CartItem = {
      id: 'x',
      type: 'custom',
      gridSize: 6,
      gridLayout: { rows: 2, cols: 3 },
      name: 'test',
      price: 480,
      quantity: 1,
      previewUrl: '',
      tileUrls: [],
      customizations: {
        categoryType: 'mosaicos',
        layoutRotated: true,
      },
    };
    const out = toPrintCustomization(item) as {
      categoryType: string;
      gridSize: number;
      layoutRotated?: boolean;
    };
    expect(out.categoryType).toBe('mosaicos');
    expect(out.gridSize).toBe(6);
    expect(out.layoutRotated).toBe(true);
  });

  test('layoutRotated survives JSON round-trip through the Shopify cart attribute', () => {
    const built = buildPrintCustomization({
      categoryType: 'mosaicos',
      gridSize: 3,
      layoutRotated: true,
    });
    const round = roundTripJson(built);
    expect(round).toEqual({
      categoryType: 'mosaicos',
      gridSize: 3,
      layoutRotated: true,
    });
  });
});

describe('known integrity gaps (documented in DEFERRED.md)', () => {
  test.todo(
    'MAJOR-fix-TODO: Tonos fitMode serialized but print pipeline does not honor it — ' +
      'TonosPrintJob lacks fitMode; processor always crops-to-fill. ' +
      'Unstub this when TonosPrintJob + tonos.ts processor both read fitMode.',
  );
});

describe('JSON round-trip (Shopify cart attribute serialization)', () => {
  // These simulate the exact JSON.stringify → JSON.parse roundtrip that
  // happens between buildCartLines and the webhook handler.
  const samples: PrintCustomizationInput[] = [
    { categoryType: 'mosaicos', gridSize: 9 },
    { categoryType: 'spotify', gridSize: 6, textFields: { songName: 'Foo', artistName: 'Bar' } },
    { categoryType: 'arte', gridSize: 9, textFields: { title: 'T', artist: 'A', year: '1999' } },
    {
      categoryType: 'studio',
      gridSize: 6,
      textFields: { year: '2001', japaneseText: 'test', customText: 'c', studioText: 's' },
    },
    {
      categoryType: 'save-the-date',
      gridSize: 9,
      textFields: {
        eventText: 'Save',
        date: '2026-06-15',
        fontFamily: 'cormorant',
        fontSize: 'M',
        color: '#FFFFFF',
        anchor: 'top-center',
        treatment: 'shadow',
        intensity: 'medium',
      },
    },
    {
      categoryType: 'tonos',
      gridSize: 9,
      tonosIntensity: 'medium',
      tonosSlots: [
        { fitMode: 'fit', rotation: 0 },
        { fitMode: 'stretch', rotation: 90 },
        { fitMode: 'fill', rotation: 180 },
      ],
    },
    { categoryType: 'polaroid', gridSize: 4 },
  ];

  test.each(samples)(
    'round-trips via JSON without loss: $categoryType',
    (input) => {
      const built = buildPrintCustomization(input);
      const roundTripped = roundTripJson(built);
      expect(roundTripped).toEqual(built);
    },
  );
});
