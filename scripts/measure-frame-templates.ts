/**
 * Measures the transparent cutout bounds of each frame-template PNG so the
 * canonical `frame.photo.tiles` constants in `src/lib/category-layouts/`
 * stay in sync with the actual images the processors composite onto.
 *
 * Run:
 *   npx tsx scripts/measure-frame-templates.ts
 *
 * Reports measured (left, top, right, bottom) vs. the layout's current
 * values and flags any tile where the delta exceeds a single pixel.
 */
import sharp from 'sharp';
import { readFile } from 'fs/promises';
import { join, resolve } from 'path';
import { polaroidLayout } from '../src/lib/category-layouts/polaroid';
import { studioLayout } from '../src/lib/category-layouts/studio';

interface Bounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * Given a raw pixel buffer (RGBA, width × height), returns the bounding
 * rectangle of fully-transparent pixels (alpha === 0). Returns `null` if
 * the image has no transparent region.
 */
function findTransparentBounds(
  pixels: Buffer,
  width: number,
  height: number,
  channels: number,
): Bounds | null {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const alpha = pixels[(y * width + x) * channels + (channels - 1)];
      if (alpha === 0) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  // The layout's "right / bottom" convention is exclusive (first pixel
  // *beyond* the photo region), matching the way the server processor uses
  // these values for sharp.extract math. So add 1 to the max values.
  return { left: minX, top: minY, right: maxX + 1, bottom: maxY + 1 };
}

async function measurePng(path: string): Promise<Bounds | null> {
  const buf = await readFile(path);
  const img = sharp(buf);
  const meta = await img.metadata();
  const raw = await img.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return findTransparentBounds(raw.data, raw.info.width, raw.info.height, raw.info.channels);
}

interface ComparedTile {
  file: string;
  measured: Bounds | null;
  layout: Bounds;
  sourceSize: number;
  resampledToSource: Bounds | null;
  delta: Bounds | null;
  ok: boolean;
}

function scaleBounds(b: Bounds, from: number, to: number): Bounds {
  const factor = to / from;
  return {
    left: Math.round(b.left * factor),
    top: Math.round(b.top * factor),
    right: Math.round(b.right * factor),
    bottom: Math.round(b.bottom * factor),
  };
}

function diffBounds(a: Bounds, b: Bounds): Bounds {
  return {
    left: a.left - b.left,
    top: a.top - b.top,
    right: a.right - b.right,
    bottom: a.bottom - b.bottom,
  };
}

function maxAbs(b: Bounds): number {
  return Math.max(
    Math.abs(b.left),
    Math.abs(b.top),
    Math.abs(b.right),
    Math.abs(b.bottom),
  );
}

async function measureCategory(
  categoryName: string,
  templateDir: string,
  layoutTiles: Record<number, Bounds>,
  sourceSize: number,
): Promise<ComparedTile[]> {
  const out: ComparedTile[] = [];
  const indices = Object.keys(layoutTiles).map(Number).sort((a, b) => a - b);
  for (const idx of indices) {
    const file = join(templateDir, `${idx + 1}.png`);
    const measured = await measurePng(file);
    const layoutBounds = layoutTiles[idx];
    // Rescale the measured bounds (native PNG resolution) into the layout's
    // canonical `sourceSize` space so they're directly comparable.
    let meta: sharp.Metadata | undefined;
    try {
      meta = await sharp(await readFile(file)).metadata();
    } catch {
      meta = undefined;
    }
    const nativeSize = meta?.width ?? sourceSize;
    const resampled = measured
      ? scaleBounds(measured, nativeSize, sourceSize)
      : null;
    const delta = resampled ? diffBounds(resampled, layoutBounds) : null;
    out.push({
      file,
      measured,
      layout: layoutBounds,
      sourceSize: nativeSize,
      resampledToSource: resampled,
      delta,
      ok: delta ? maxAbs(delta) <= 1 : false,
    });
  }
  console.log(`\n=== ${categoryName} ===`);
  for (const tile of out) {
    const idx = out.indexOf(tile);
    console.log(
      `tile ${idx + 1} [${tile.file.split('/').pop()}]: native ${tile.sourceSize}px`,
    );
    console.log(`  measured (native): ${JSON.stringify(tile.measured)}`);
    console.log(`  resampled→${sourceSize}: ${JSON.stringify(tile.resampledToSource)}`);
    console.log(`  layout: ${JSON.stringify(tile.layout)}`);
    console.log(`  delta: ${JSON.stringify(tile.delta)} ${tile.ok ? 'OK' : '⚠ DRIFT >1px'}`);
  }
  return out;
}

async function main() {
  const root = resolve(process.cwd());
  const polaroidDir = join(root, 'public/templates/polaroid');
  const studioDir = join(root, 'public/templates/studio');

  await measureCategory(
    'Polaroid',
    polaroidDir,
    polaroidLayout.frame!.photo.tiles,
    polaroidLayout.frame!.photo.sourceSize,
  );
  await measureCategory(
    'Studio',
    studioDir,
    studioLayout.frame!.photo.tiles,
    studioLayout.frame!.photo.sourceSize,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
