/**
 * Integrity test: per-category print-processor contract
 *
 * Each processor in `src/lib/print-pipeline/processors/` is the final
 * author of the PNGs the admin eventually prints. They are tolerant
 * of funny inputs (a 1x1 pixel input still runs through to output),
 * so the only meaningful contract tests are shape guarantees:
 *
 *   1. Tile count equals the grid tile count (3/4/6/9 per category).
 *   2. Every tile is a 827×827 PNG — the 7 cm at 300 dpi target.
 *   3. Every tile carries a stable `index` matching its position and a
 *      filename referencing the jobId + index.
 *   4. Text-bearing processors (spotify/arte/studio/save-the-date) also
 *      produce 827×827 tiles; text content can't be verified in a
 *      pixel-level test (would couple to libvips font rendering), but
 *      non-empty PNG bytes + dimension sanity is the contract we can pin.
 *
 * Tonos fitMode is now honored end-to-end (Phase 2) — see the
 * dedicated describe block below for pixel-level proof.
 *
 * Remaining open gaps (Phase 3+ work) are captured as `test.todo`:
 *   - composite-reuse metadata is stored in the cart but not forwarded
 *     to Shopify; the webhook always re-renders.
 *   - Studio CJK fallback is missing on Vercel runtime.
 */
import { describe, test, expect, beforeAll } from 'vitest';
import sharp from 'sharp';
import type {
  SingleImagePrintJob,
  TonosPrintJob,
  TileOutput,
} from '@/lib/print-pipeline/types';
import {
  processPrintJob,
  assembleTilesToComposite,
  getCompositeLayout,
} from '@/lib/print-pipeline';

// ─── Fixture: a valid, decodable input image ────────────────────────────────

/**
 * Generates a 2000×2000 solid-magenta JPEG buffer — large enough that
 * every processor's crop step has pixels to work with, small enough to
 * keep the suite fast. Deterministic output so flaky file reads aren't
 * a concern.
 */
let SOURCE_IMAGE: Buffer;

beforeAll(async () => {
  SOURCE_IMAGE = await sharp({
    create: {
      width: 2000,
      height: 2000,
      channels: 3,
      background: { r: 200, g: 80, b: 110 },
    },
  })
    .jpeg({ quality: 90 })
    .toBuffer();
}, 15_000);

async function pngDimensions(buf: Buffer): Promise<{ w: number; h: number }> {
  const meta = await sharp(buf).metadata();
  return { w: meta.width ?? 0, h: meta.height ?? 0 };
}

function assertPngSignature(buf: Buffer): void {
  // Every tile MUST be a real PNG, not a wrapped JPEG, not an SVG.
  // PNG bytes start with 89 50 4E 47 0D 0A 1A 0A (1-based: 89 "PNG" CRLF EOF LF).
  expect(buf[0]).toBe(0x89);
  expect(buf[1]).toBe(0x50);
  expect(buf[2]).toBe(0x4e);
  expect(buf[3]).toBe(0x47);
}

async function assertTileContract(
  tiles: TileOutput[],
  expected: { count: number; jobId: string },
): Promise<void> {
  expect(tiles).toHaveLength(expected.count);

  // Indices must be a 0..N-1 permutation — each covers exactly one slot.
  const indexes = tiles.map((t) => t.index).sort((a, b) => a - b);
  expect(indexes).toEqual(
    Array.from({ length: expected.count }, (_, i) => i),
  );

  // Filenames must be referenceable back to the jobId.
  for (const tile of tiles) {
    expect(tile.filename).toContain(expected.jobId);
    expect(typeof tile.buffer).toBe('object');
    assertPngSignature(tile.buffer);
    const { w, h } = await pngDimensions(tile.buffer);
    expect(w).toBe(827);
    expect(h).toBe(827);
  }
}

// Full-canvas crop area — exercises the crop path without landing on a
// degenerate slice that trips assertions in `cropAndResize`.
const FULL_CROP = { x: 0, y: 0, width: 2000, height: 2000 };

// ─── Single-image categories ────────────────────────────────────────────────

describe('processor contract — single-image categories', () => {
  test('mosaicos 9 → 9 tiles @ 827×827 PNG', async () => {
    const job: SingleImagePrintJob = {
      imageBuffer: SOURCE_IMAGE,
      customization: { categoryType: 'mosaicos', gridSize: 9 },
      cropArea: FULL_CROP,
      jobId: 'test-mosaicos-9',
    };
    const result = await processPrintJob(job);
    expect(result.categoryType).toBe('mosaicos');
    expect(result.tileCount).toBe(9);
    await assertTileContract(result.tiles, { count: 9, jobId: job.jobId });
  }, 30_000);

  test('mosaicos 6 → 6 tiles @ 827×827 PNG', async () => {
    const job: SingleImagePrintJob = {
      imageBuffer: SOURCE_IMAGE,
      customization: { categoryType: 'mosaicos', gridSize: 6 },
      cropArea: FULL_CROP,
      jobId: 'test-mosaicos-6',
    };
    const result = await processPrintJob(job);
    await assertTileContract(result.tiles, { count: 6, jobId: job.jobId });
  }, 30_000);

  test('mosaicos 3 → 3 tiles @ 827×827 PNG', async () => {
    const job: SingleImagePrintJob = {
      imageBuffer: SOURCE_IMAGE,
      customization: { categoryType: 'mosaicos', gridSize: 3 },
      cropArea: FULL_CROP,
      jobId: 'test-mosaicos-3',
    };
    const result = await processPrintJob(job);
    await assertTileContract(result.tiles, { count: 3, jobId: job.jobId });
  }, 30_000);

  test('spotify → 6 tiles, text panel rendered without throwing', async () => {
    const job: SingleImagePrintJob = {
      imageBuffer: SOURCE_IMAGE,
      customization: {
        categoryType: 'spotify',
        gridSize: 6,
        songName: 'Cucurrucucú paloma',
        artistName: 'Caetano Veloso',
      },
      cropArea: FULL_CROP,
      jobId: 'test-spotify',
    };
    const result = await processPrintJob(job);
    await assertTileContract(result.tiles, { count: 6, jobId: job.jobId });
  }, 30_000);

  test('arte → 9 tiles, info panel composited on a dedicated slot', async () => {
    const job: SingleImagePrintJob = {
      imageBuffer: SOURCE_IMAGE,
      customization: {
        categoryType: 'arte',
        gridSize: 9,
        title: 'La Mona Lisa',
        artist: 'Leonardo da Vinci',
        year: '1503',
      },
      cropArea: FULL_CROP,
      jobId: 'test-arte',
    };
    const result = await processPrintJob(job);
    await assertTileContract(result.tiles, { count: 9, jobId: job.jobId });
  }, 30_000);

  test('save-the-date → 9 tiles with full text-effect stack', async () => {
    const job: SingleImagePrintJob = {
      imageBuffer: SOURCE_IMAGE,
      customization: {
        categoryType: 'save-the-date',
        gridSize: 9,
        eventText: 'Save the Date\n15 de junio',
        date: '2026-06-15',
        fontFamily: 'great-vibes',
        fontSize: 'L',
        color: '#FFFFFF',
        anchor: 'bottom-center',
        treatment: 'halo',
        intensity: 'intense',
      },
      cropArea: FULL_CROP,
      jobId: 'test-std',
    };
    const result = await processPrintJob(job);
    await assertTileContract(result.tiles, { count: 9, jobId: job.jobId });
  }, 30_000);

  test('polaroid → 4 tiles composited over frame templates', async () => {
    const job: SingleImagePrintJob = {
      imageBuffer: SOURCE_IMAGE,
      customization: { categoryType: 'polaroid', gridSize: 4 },
      cropArea: FULL_CROP,
      jobId: 'test-polaroid',
    };
    const result = await processPrintJob(job);
    await assertTileContract(result.tiles, { count: 4, jobId: job.jobId });
  }, 30_000);

  test('studio → 6 tiles (4 photo + 2 text panels, all 827×827)', async () => {
    const job: SingleImagePrintJob = {
      imageBuffer: SOURCE_IMAGE,
      customization: {
        categoryType: 'studio',
        gridSize: 6,
        year: '2001',
        japaneseText: '千と千尋の神隠し',
        customText: 'EL VIAJE DE CHIHIRO',
        studioText: 'STUDIO GHIBLI',
      },
      cropArea: FULL_CROP,
      jobId: 'test-studio',
    };
    const result = await processPrintJob(job);
    await assertTileContract(result.tiles, { count: 6, jobId: job.jobId });
  }, 30_000);
});

// ─── Tonos (multi-image) ────────────────────────────────────────────────────

// ─── Mosaicos layoutRotated (FIXED, was BLOCKER finding #7) ─────────────────

describe('processor contract — mosaicos layoutRotated', () => {
  /**
   * Feed an intentionally-asymmetric (non-uniform) source image so
   * `splitIntoTiles` produces different buffers per tile position. A
   * solid-color source would split into identical tiles regardless of
   * rows/cols order, defeating the buffer-inequality assertion below.
   */
  let ASYMMETRIC_SOURCE: Buffer;

  beforeAll(async () => {
    ASYMMETRIC_SOURCE = await sharp({
      create: {
        width: 2000,
        height: 2000,
        channels: 3,
        background: { r: 220, g: 60, b: 90 },
      },
    })
      // Draw a gradient-like overlay via composite to break rotational
      // symmetry of the output. The specific shape doesn't matter —
      // only that tile(row=a,col=b) differs from tile(row=b,col=a).
      .composite([
        {
          input: Buffer.from(
            `<svg xmlns="http://www.w3.org/2000/svg" width="2000" height="2000">
              <rect x="0" y="0" width="2000" height="400" fill="black"/>
              <rect x="0" y="0" width="400" height="2000" fill="white"/>
            </svg>`,
          ),
          top: 0,
          left: 0,
        },
      ])
      .jpeg({ quality: 90 })
      .toBuffer();
  }, 15_000);

  test('rotated Mosaicos 6 → 6 tiles; composite reassembles to 3-cols × 2-rows (landscape 2481×1654)', async () => {
    const unrotated = await processPrintJob({
      imageBuffer: ASYMMETRIC_SOURCE,
      customization: { categoryType: 'mosaicos', gridSize: 6 },
      cropArea: FULL_CROP,
      jobId: 'test-m6-unrot',
    });
    const rotated = await processPrintJob({
      imageBuffer: ASYMMETRIC_SOURCE,
      customization: {
        categoryType: 'mosaicos',
        gridSize: 6,
        layoutRotated: true,
      },
      cropArea: FULL_CROP,
      jobId: 'test-m6-rot',
    });

    await assertTileContract(rotated.tiles, {
      count: 6,
      jobId: 'test-m6-rot',
    });

    // Buffer-level inequality: a wrong implementation could still pass
    // by accident, so we chain this with the stronger composite-shape
    // assertion below.
    const anyTileDiffers = rotated.tiles.some((rt) => {
      const match = unrotated.tiles.find((ut) => ut.index === rt.index);
      return !match || !rt.buffer.equals(match.buffer);
    });
    expect(anyTileDiffers).toBe(true);

    // Composite-dimension oracle: the rotated composite layout must
    // place the 6 tiles in a 3-wide × 2-tall arrangement → 2481×1654.
    // Unrotated is 2-wide × 3-tall → 1654×2481. This is a directional
    // check — a wrong permutation can't accidentally produce matching
    // dimensions.
    const rotatedLayout = getCompositeLayout({
      categoryType: 'mosaicos',
      gridSize: 6,
      layoutRotated: true,
    });
    const unrotatedLayout = getCompositeLayout({
      categoryType: 'mosaicos',
      gridSize: 6,
    });
    expect(rotatedLayout.width).toBe(3 * 827); // 2481
    expect(rotatedLayout.height).toBe(2 * 827); // 1654
    expect(unrotatedLayout.width).toBe(2 * 827); // 1654
    expect(unrotatedLayout.height).toBe(3 * 827); // 2481

    // And the reassembled PNG really is 2481×1654:
    const rotatedComposite = await assembleTilesToComposite(
      rotated.tiles,
      rotatedLayout,
    );
    const meta = await sharp(rotatedComposite).metadata();
    expect(meta.width).toBe(2481);
    expect(meta.height).toBe(1654);
  }, 60_000);

  test('rotated Mosaicos 3 → 3 tiles; composite is vertical (1×3 → 3×1)', async () => {
    const unrotated = await processPrintJob({
      imageBuffer: ASYMMETRIC_SOURCE,
      customization: { categoryType: 'mosaicos', gridSize: 3 },
      cropArea: FULL_CROP,
      jobId: 'test-m3-unrot',
    });
    const rotated = await processPrintJob({
      imageBuffer: ASYMMETRIC_SOURCE,
      customization: {
        categoryType: 'mosaicos',
        gridSize: 3,
        layoutRotated: true,
      },
      cropArea: FULL_CROP,
      jobId: 'test-m3-rot',
    });

    await assertTileContract(rotated.tiles, {
      count: 3,
      jobId: 'test-m3-rot',
    });
    const anyTileDiffers = rotated.tiles.some((rt) => {
      const match = unrotated.tiles.find((ut) => ut.index === rt.index);
      return !match || !rt.buffer.equals(match.buffer);
    });
    expect(anyTileDiffers).toBe(true);

    // Unrotated: 1 row × 3 cols (3*827 × 1*827 = 2481×827).
    // Rotated: 3 rows × 1 col (1*827 × 3*827 = 827×2481).
    const rotatedLayout = getCompositeLayout({
      categoryType: 'mosaicos',
      gridSize: 3,
      layoutRotated: true,
    });
    const unrotatedLayout = getCompositeLayout({
      categoryType: 'mosaicos',
      gridSize: 3,
    });
    expect(rotatedLayout.width).toBe(827);
    expect(rotatedLayout.height).toBe(3 * 827);
    expect(unrotatedLayout.width).toBe(3 * 827);
    expect(unrotatedLayout.height).toBe(827);
  }, 45_000);

  test('rotated Mosaicos 9 is a no-op — tile buffers match unrotated (square grid)', async () => {
    // Symmetric swap: 3×3 → 3×3. Bit-for-bit equivalence is the
    // strongest regression pin against accidentally permuting tiles
    // in the square-grid case.
    const unrotated = await processPrintJob({
      imageBuffer: ASYMMETRIC_SOURCE,
      customization: { categoryType: 'mosaicos', gridSize: 9 },
      cropArea: FULL_CROP,
      jobId: 'test-m9-unrot',
    });
    const rotated = await processPrintJob({
      imageBuffer: ASYMMETRIC_SOURCE,
      customization: {
        categoryType: 'mosaicos',
        gridSize: 9,
        layoutRotated: true,
      },
      cropArea: FULL_CROP,
      jobId: 'test-m9-rot',
    });

    expect(rotated.tiles).toHaveLength(9);
    for (const rt of rotated.tiles) {
      const match = unrotated.tiles.find((ut) => ut.index === rt.index);
      expect(match).toBeDefined();
      expect(rt.buffer.equals(match!.buffer)).toBe(true);
    }
  }, 60_000);
});

describe('processor contract — tonos (multi-image)', () => {
  test('tonos 9 (3 images → 9 tonal tiles) @ 827×827 PNG', async () => {
    const job: TonosPrintJob = {
      imageBuffers: [SOURCE_IMAGE, SOURCE_IMAGE, SOURCE_IMAGE],
      customization: {
        categoryType: 'tonos',
        gridSize: 9,
        intensity: 'medium',
      },
      cropAreas: [FULL_CROP, FULL_CROP, FULL_CROP],
      jobId: 'test-tonos-9',
    };
    const result = await processPrintJob(job);
    await assertTileContract(result.tiles, { count: 9, jobId: job.jobId });
  }, 45_000);

  test('tonos 3 (3 images → 3 tonal tiles) @ 827×827 PNG', async () => {
    const job: TonosPrintJob = {
      imageBuffers: [SOURCE_IMAGE, SOURCE_IMAGE, SOURCE_IMAGE],
      customization: {
        categoryType: 'tonos',
        gridSize: 3,
        intensity: 'medium',
      },
      cropAreas: [FULL_CROP, FULL_CROP, FULL_CROP],
      jobId: 'test-tonos-3',
    };
    const result = await processPrintJob(job);
    await assertTileContract(result.tiles, { count: 3, jobId: job.jobId });
  }, 45_000);

  test('tonos intensity="strong" no longer crashes — hue is rounded before Sharp', async () => {
    // Prior to the Math.round(config.hueRotation) fix in
    // processors/tonos.ts, the 'strong' preset scaled the base hue
    // 15° × 1.5 → 22.5°, and Sharp's modulate rejected the fractional
    // input with "Expected number for hue but received 22.5". The
    // processor now rounds at the pipeline boundary so the same user-
    // facing setting produces a valid tile set.
    const job: TonosPrintJob = {
      imageBuffers: [SOURCE_IMAGE, SOURCE_IMAGE, SOURCE_IMAGE],
      customization: {
        categoryType: 'tonos',
        gridSize: 9,
        intensity: 'strong',
      },
      cropAreas: [FULL_CROP, FULL_CROP, FULL_CROP],
      jobId: 'test-tonos-strong',
    };
    const result = await processPrintJob(job);
    await assertTileContract(result.tiles, { count: 9, jobId: job.jobId });
  }, 45_000);

  test('tonos honors whitelisted rotations without corrupting output', async () => {
    const job: TonosPrintJob = {
      imageBuffers: [SOURCE_IMAGE, SOURCE_IMAGE, SOURCE_IMAGE],
      customization: {
        categoryType: 'tonos',
        gridSize: 9,
        intensity: 'medium',
      },
      cropAreas: [FULL_CROP, FULL_CROP, FULL_CROP],
      rotations: [0, 90, 270],
      jobId: 'test-tonos-rot',
    };
    const result = await processPrintJob(job);
    await assertTileContract(result.tiles, { count: 9, jobId: job.jobId });
  }, 45_000);
});

// ─── Tonos fitMode end-to-end (FIXED, was MAJOR) ────────────────────────────

describe('tonos — fitMode honored by the print pipeline', () => {
  /**
   * Pixel-level proof that `processTonos` honors the per-slot fitMode
   * threaded through `TonosPrintJob.fitModes`.
   *
   * Source: a 800×2000 tall image with three horizontal stripes — the
   * top 5% cyan, middle 90% red, bottom 5% yellow. The stripes at the
   * very edges of the source are the discriminator: Sharp `'cover'`
   * crops top+bottom (only the middle red survives in the tile),
   * whereas Sharp `'fill'` (non-uniform stretch) compresses every row
   * into the tile (cyan top + yellow bottom both visible). Solid-red
   * sources can't tell `'cover'` from `'fill'` apart — Codex pointed
   * this out as a NIT — so the structured stripes give the test real
   * discrimination power.
   *
   * The 9-grid layout is row-by-source × column-by-tone
   * (warm/none/cool); the middle column (`'none'` tone) carries
   * unfiltered output, so tiles 1 (slot 0), 4 (slot 1), 7 (slot 2)
   * are pure pre-filter pixels. Tile 8 is logo-stamped — avoided.
   *
   * With fitModes = ['fit', 'fill', 'stretch']:
   *   - `'fit'`     → contain on cream     → side corners = cream.
   *   - `'fill'`    → cover (crop top+btm) → top + bottom corners = red.
   *   - `'stretch'` → non-uniform fill     → top corner = cyan,
   *                                          bottom corner = yellow.
   *
   * Sampling at `(5, 5)` and `(5, 822)` (= TILE_PRINT_SIZE − 5)
   * avoids lanczos boundary blur on every edge; tolerance is ±5 RGB
   * to absorb resampling + PNG round-tripping.
   */
  test('fitMode="fit" letterboxes; "fill" crops; "stretch" stretches non-uniformly', async () => {
    // Build the striped fixture row-by-row using Sharp's `composite`.
    const W = 800;
    const H = 2000;
    const topH = Math.round(H * 0.05); // 100
    const botH = Math.round(H * 0.05); // 100
    const midH = H - topH - botH;       // 1800
    const stripe = async (
      width: number,
      height: number,
      color: { r: number; g: number; b: number },
    ): Promise<Buffer> =>
      sharp({
        create: { width, height, channels: 3, background: color },
      })
        .png()
        .toBuffer();
    const cyan = await stripe(W, topH, { r: 30, g: 200, b: 220 });
    const red = await stripe(W, midH, { r: 220, g: 30, b: 30 });
    const yellow = await stripe(W, botH, { r: 230, g: 200, b: 40 });
    const STRIPED = await sharp({
      create: { width: W, height: H, channels: 3, background: { r: 0, g: 0, b: 0 } },
    })
      .composite([
        { input: cyan, top: 0, left: 0 },
        { input: red, top: topH, left: 0 },
        { input: yellow, top: topH + midH, left: 0 },
      ])
      .jpeg({ quality: 95 })
      .toBuffer();
    const TALL_CROP = { x: 0, y: 0, width: W, height: H };

    const job: TonosPrintJob = {
      imageBuffers: [STRIPED, STRIPED, STRIPED],
      customization: {
        categoryType: 'tonos',
        gridSize: 9,
        intensity: 'medium',
      },
      cropAreas: [TALL_CROP, TALL_CROP, TALL_CROP],
      fitModes: ['fit', 'fill', 'stretch'],
      jobId: 'test-tonos-fitmode',
    };
    const result = await processPrintJob(job);
    await assertTileContract(result.tiles, { count: 9, jobId: job.jobId });

    const byIndex = new Map(result.tiles.map((t) => [t.index, t]));
    const fitTile = byIndex.get(1);
    const fillTile = byIndex.get(4);
    const stretchTile = byIndex.get(7);
    expect(fitTile).toBeDefined();
    expect(fillTile).toBeDefined();
    expect(stretchTile).toBeDefined();

    async function samplePixel(
      buf: Buffer,
      x: number,
      y: number,
    ): Promise<{ r: number; g: number; b: number }> {
      const { data, info } = await sharp(buf).raw().toBuffer({ resolveWithObject: true });
      const idx = (y * info.width + x) * info.channels;
      return { r: data[idx], g: data[idx + 1], b: data[idx + 2] };
    }

    // 'fit' → cream letterbox (#efebe0 = 239, 235, 224) on the sides
    // of the contained striped image. (5,5) is in the left stripe.
    const fitCorner = await samplePixel(fitTile!.buffer, 5, 5);
    expect(Math.abs(fitCorner.r - 239)).toBeLessThanOrEqual(5);
    expect(Math.abs(fitCorner.g - 235)).toBeLessThanOrEqual(5);
    expect(Math.abs(fitCorner.b - 224)).toBeLessThanOrEqual(5);

    // 'fill' (cover) → top 5% (cyan) + bottom 5% (yellow) cropped off.
    // Both top corner (5,5) and bottom corner (5, 822) land inside the
    // middle red band, far from the boundaries.
    const fillTop = await samplePixel(fillTile!.buffer, 5, 5);
    const fillBottom = await samplePixel(fillTile!.buffer, 5, 822);
    expect(fillTop.r).toBeGreaterThan(180);
    expect(fillTop.g).toBeLessThan(80);
    expect(fillTop.b).toBeLessThan(80);
    expect(fillBottom.r).toBeGreaterThan(180);
    expect(fillBottom.g).toBeLessThan(80);
    expect(fillBottom.b).toBeLessThan(80);

    // 'stretch' (non-uniform fill) → all 2000 source rows compressed
    // into 827 tile rows. Top corner samples the cyan stripe (high
    // green + blue, low red); bottom corner samples the yellow stripe
    // (high red + green, low blue). This is the assertion that proves
    // 'stretch' is genuinely different from 'fill' (cover) — solid
    // red couldn't.
    const stretchTop = await samplePixel(stretchTile!.buffer, 5, 5);
    const stretchBottom = await samplePixel(stretchTile!.buffer, 5, 822);
    expect(stretchTop.r).toBeLessThan(80);
    expect(stretchTop.g).toBeGreaterThan(150);
    expect(stretchTop.b).toBeGreaterThan(150);
    expect(stretchBottom.r).toBeGreaterThan(180);
    expect(stretchBottom.g).toBeGreaterThan(150);
    expect(stretchBottom.b).toBeLessThan(80);
  }, 45_000);
});

// ─── Known contract gaps (MAJOR findings from the audit) ────────────────────

describe('processor contract — known gaps (see DEFERRED.md)', () => {

  test.todo(
    'MAJOR-fix-TODO: composite-reuse metadata stored in cart but not ' +
      'forwarded to Shopify — checkout.ts#buildCartLines omits ' +
      'compositeKey/compositeUrl from line-item attrs, so the webhook ' +
      'always re-renders. Means abandoned composites accumulate in R2 ' +
      'and the webhook does 2x the Sharp work. Forward compositeKey as ' +
      '_composite_key and let the webhook split from it when present.',
  );

  test.todo(
    'MINOR-fix-TODO: Studio Japanese text rendered with generic sans-serif — ' +
      'studio.ts passes font-family: sans-serif in the SVG and relies on ' +
      "the Vercel runtime having a CJK fallback installed. Fontconfig's " +
      'default chain on Vercel Functions does NOT include a CJK font, so ' +
      'Japanese characters can render as tofu. Bundle Noto Sans JP (or ' +
      'similar) and pin font-family explicitly for the japaneseText layer.',
  );

  test.todo(
    'MINOR-fix-TODO: grid_type / preview_image_url line-item attributes ' +
      'are attached without the `_` prefix — the webhook `_`-filter in ' +
      'extractCustomizedLineItems drops them, but the admin email ' +
      'template reads them from the same attrs. Either prefix both ' +
      'with `_` at the source and rename the reader, or teach the ' +
      'extractor to preserve a whitelist of display-only attrs.',
  );
});
