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
 * Open gaps (Phase 3+ work) are captured as `test.todo`:
 *   - Tonos fitMode is serialized end-to-end but the processor ignores
 *     it → `processTonos` uses fixed crop-to-fill.
 *   - `layoutRotated` never reaches the processor → Mosaicos 3/6 ships
 *     in the wrong orientation for rotated layouts.
 */
import { describe, test, expect, beforeAll } from 'vitest';
import sharp from 'sharp';
import type {
  SingleImagePrintJob,
  TonosPrintJob,
  TileOutput,
} from '@/lib/print-pipeline/types';
import { processPrintJob } from '@/lib/print-pipeline';

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
    // NOTE: intensity='medium' (not 'strong') is deliberate here. With
    // `strong` the filter preset multiplies the base hue rotation by
    // 1.5, producing `hue: 22.5`, which Sharp's `modulate()` rejects
    // because it requires an integer. That's a shipped-today crash
    // path captured as a new BLOCKER in the todo list below.
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

// ─── Known contract gaps (MAJOR findings from the audit) ────────────────────

describe('processor contract — known gaps (see DEFERRED.md)', () => {
  test.todo(
    'NEW-BLOCKER-from-test-suite: processTonos crashes when intensity="strong" ' +
      '— filter-presets scaleTone multiplies base hue 15° by 1.5 → 22.5°, ' +
      'and sharp.modulate({ hue }) rejects non-integer values with ' +
      '"Expected number for hue but received 22.5". Any user-facing Tonos ' +
      'render with intensity="strong" will throw at order time. Fix by ' +
      'rounding the hue in applySharpFilter (tonos.ts:96) before calling ' +
      'modulate, or by producing integer base hues in filter-presets.ts.',
  );

  test.todo(
    'MAJOR-fix-TODO: Tonos fitMode not honored — TonosPrintJob lacks a ' +
      'fitMode field; processTonos always crops-to-fill. Serializer ' +
      'retains fitMode via a cast but it dies at the pipeline boundary. ' +
      'Add `fitMode?: [FitMode, FitMode, FitMode]` to TonosPrintJob, ' +
      'thread it through cropAndResize, and assert that fitMode="fit" ' +
      'produces a letterboxed tile (detectable via background pixel ' +
      'sampling at the tile corners).',
  );

  test.todo(
    'MAJOR-fix-TODO: layoutRotated never reaches serializer — builder ' +
      'captures portrait/landscape orientation in `layoutRotated` but ' +
      'buildPrintCustomization drops it. For rotated Mosaicos 3/6 this ' +
      'means the print processor uses the unrotated grid and ships the ' +
      'wrong tile arrangement. Add `layoutRotated?: boolean` to the ' +
      'mosaicos union variant, serialize it, and have processMosaicos ' +
      'swap rows/cols when true.',
  );

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
