/**
 * One-time migration: detect seam positions for all product images.
 * Usage: npx tsx scripts/migrate-seam-data.ts
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import sharp from 'sharp';

// ─── Inline seam detection (avoids path aliases) ────────────────────────────

const BAND_PERCENT = 0.04;
const MIN_BAND_PX = 16;
const MIN_CONTRAST_DIFF = 25;

interface SeamResult { position: number; width: number; }

async function findSeam(
  imageBuffer: Buffer,
  imgWidth: number,
  imgHeight: number,
  direction: 'vertical' | 'horizontal',
  expectedPos: number,
): Promise<SeamResult | null> {
  const dimension = direction === 'vertical' ? imgWidth : imgHeight;
  const bandHalf = Math.max(MIN_BAND_PX, Math.round(dimension * BAND_PERCENT));
  const bandStart = Math.max(0, expectedPos - bandHalf);
  const bandEnd = Math.min(dimension, expectedPos + bandHalf);

  const extractRegion = direction === 'vertical'
    ? { left: bandStart, top: 0, width: bandEnd - bandStart, height: imgHeight }
    : { left: 0, top: bandStart, width: imgWidth, height: bandEnd - bandStart };
  if (extractRegion.width <= 0 || extractRegion.height <= 0) return null;

  const { data, info } = await sharp(imageBuffer)
    .extract(extractRegion)
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const bandSize = direction === 'vertical' ? info.width : info.height;
  const scanLength = direction === 'vertical' ? info.height : info.width;

  const means: number[] = [];
  for (let s = 0; s < bandSize; s++) {
    let sum = 0;
    for (let p = 0; p < scanLength; p++) {
      const pixelIdx = direction === 'vertical' ? p * info.width + s : s * info.width + p;
      sum += data[pixelIdx];
    }
    means.push(sum / scanLength);
  }

  const edgeSamples = Math.min(4, Math.floor(bandSize / 4));
  let baselineSum = 0, baselineCount = 0;
  for (let i = 0; i < edgeSamples; i++) {
    baselineSum += means[i] + means[bandSize - 1 - i];
    baselineCount += 2;
  }
  const baseline = baselineSum / baselineCount;

  let minMean = Infinity, minIdx = 0, maxMean = -Infinity, maxIdx = 0;
  for (let i = 0; i < means.length; i++) {
    if (means[i] < minMean) { minMean = means[i]; minIdx = i; }
    if (means[i] > maxMean) { maxMean = means[i]; maxIdx = i; }
  }

  const darkContrast = baseline - minMean;
  const lightContrast = maxMean - baseline;
  const isDark = darkContrast >= lightContrast;
  const contrast = isDark ? darkContrast : lightContrast;
  const seamIdx = isDark ? minIdx : maxIdx;

  if (contrast < MIN_CONTRAST_DIFF) return null;

  const threshold = isDark ? baseline - contrast * 0.5 : baseline + contrast * 0.5;
  let seamStart = seamIdx, seamEnd = seamIdx;
  if (isDark) {
    while (seamStart > 0 && means[seamStart - 1] < threshold) seamStart--;
    while (seamEnd < means.length - 1 && means[seamEnd + 1] < threshold) seamEnd++;
  } else {
    while (seamStart > 0 && means[seamStart - 1] > threshold) seamStart--;
    while (seamEnd < means.length - 1 && means[seamEnd + 1] > threshold) seamEnd++;
  }

  return { position: bandStart + Math.round((seamStart + seamEnd) / 2), width: seamEnd - seamStart + 1 };
}

// ─── Products ───────────────────────────────────────────────────────────────

interface Product { id: string; image: string; grid: string; rows: number; cols: number; }

const PRODUCTS: Product[] = [
  { id: 'mos-1', image: '/products/mosaicos/familiar-9.png', grid: '3x3', rows: 3, cols: 3 },
  { id: 'mos-2', image: '/products/mosaicos/pareja-6.png', grid: '2x3', rows: 3, cols: 2 },
  { id: 'mos-3', image: '/products/mosaicos/panoramico-3.png', grid: '3x1', rows: 1, cols: 3 },
  { id: 'mos-4', image: '/products/mosaicos/mascota-6.png', grid: '3x2', rows: 2, cols: 3 },
  { id: 'mos-5', image: '/products/mosaicos/familiar-9-2.png', grid: '3x3', rows: 3, cols: 3 },
  { id: 'mos-6', image: '/products/mosaicos/panoramico-3-2.png', grid: '1x3', rows: 3, cols: 1 },
  { id: 'stu-1', image: '/products/studio/chihiro.png', grid: '2x3', rows: 3, cols: 2 },
  { id: 'stu-2', image: '/products/studio/totoro.png', grid: '2x3', rows: 3, cols: 2 },
  { id: 'stu-3', image: '/products/studio/mononoke.png', grid: '2x3', rows: 3, cols: 2 },
  { id: 'stu-4', image: '/products/studio/howl.png', grid: '2x3', rows: 3, cols: 2 },
  { id: 'stu-5', image: '/products/studio/chihiro-2.png', grid: '2x3', rows: 3, cols: 2 },
  { id: 'stu-6', image: '/products/studio/kiki.png', grid: '2x3', rows: 3, cols: 2 },
  { id: 'stu-7', image: '/products/studio/ponyo.png', grid: '2x3', rows: 3, cols: 2 },
  { id: 'stu-8', image: '/products/studio/garza.png', grid: '2x3', rows: 3, cols: 2 },
  { id: 'art-1', image: '/products/arte/noche-estrellada.png', grid: '4x3', rows: 3, cols: 4 },
  { id: 'art-2', image: '/products/arte/mona-lisa.png', grid: '4x3', rows: 3, cols: 4 },
  { id: 'art-3', image: '/products/arte/el-beso.png', grid: '4x3', rows: 3, cols: 4 },
  { id: 'art-4', image: '/products/arte/gran-ola.png', grid: '4x3', rows: 3, cols: 4 },
  { id: 'art-5', image: '/products/arte/joven-perla.png', grid: '4x3', rows: 3, cols: 4 },
  { id: 'art-6', image: '/products/arte/dos-fridas.png', grid: '4x3', rows: 3, cols: 4 },
  { id: 'art-7', image: '/products/arte/nenufares.png', grid: '4x3', rows: 3, cols: 4 },
  { id: 'art-8', image: '/products/arte/venus.png', grid: '4x3', rows: 3, cols: 4 },
  { id: 'std-1', image: '/products/save-the-date/boda-9.png', grid: '3x3', rows: 3, cols: 3 },
  { id: 'std-2', image: '/products/save-the-date/compromiso-6.png', grid: '2x3', rows: 3, cols: 2 },
  { id: 'std-3', image: '/products/save-the-date/baby-3.png', grid: '1x3', rows: 3, cols: 1 },
  { id: 'ton-1', image: '/products/tonos/rosas-9.png', grid: '3x3', rows: 3, cols: 3 },
  { id: 'ton-2', image: '/products/tonos/girasoles-3.png', grid: '1x3', rows: 3, cols: 1 },
  { id: 'spo-1', image: '/products/spotify/album-1.png', grid: '2x3', rows: 3, cols: 2 },
  { id: 'spo-2', image: '/products/spotify/personalizado.png', grid: '2x3', rows: 3, cols: 2 },
  { id: 'pol-1', image: '/products/polaroid/clasico.png', grid: '2x2', rows: 2, cols: 2 },
  { id: 'pol-2', image: '/products/polaroid/vintage.png', grid: '2x2', rows: 2, cols: 2 },
];

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const publicDir = resolve(__dirname, '..', 'public');
  const results: Record<string, { vertical: number[]; horizontal: number[]; widthPercent: number; confidence: number }> = {};

  for (const product of PRODUCTS) {
    const imagePath = resolve(publicDir, product.image.replace(/^\//, ''));
    let imageBuffer: Buffer;
    try { imageBuffer = readFileSync(imagePath); } catch { console.log(`SKIP ${product.id}`); continue; }

    const metadata = await sharp(imageBuffer).metadata();
    const width = metadata.width!, height = metadata.height!;

    const verticalSeams: number[] = [], horizontalSeams: number[] = [], allWidths: number[] = [];

    for (let i = 1; i < product.cols; i++) {
      const result = await findSeam(imageBuffer, width, height, 'vertical', Math.round(width * i / product.cols));
      if (result) { verticalSeams.push(parseFloat((result.position / width).toFixed(6))); allWidths.push(result.width / width); }
    }
    for (let j = 1; j < product.rows; j++) {
      const result = await findSeam(imageBuffer, width, height, 'horizontal', Math.round(height * j / product.rows));
      if (result) { horizontalSeams.push(parseFloat((result.position / height).toFixed(6))); allWidths.push(result.width / height); }
    }

    const expectedSeams = (product.cols - 1) + (product.rows - 1);
    const detectedSeams = verticalSeams.length + horizontalSeams.length;
    const confidence = expectedSeams > 0 ? detectedSeams / expectedSeams : 1;
    const avgWidth = allWidths.length > 0 ? parseFloat((allWidths.reduce((a, b) => a + b, 0) / allWidths.length).toFixed(6)) : 0.005;

    results[product.id] = { vertical: verticalSeams, horizontal: horizontalSeams, widthPercent: avgWidth, confidence };
    console.log(`${confidence >= 0.7 ? 'OK' : 'LOW'} ${product.id} (${product.grid}): conf=${confidence.toFixed(2)} v=[${verticalSeams.join(',')}] h=[${horizontalSeams.join(',')}] w=${avgWidth}`);
  }

  console.log('\n// ─── seamData snippet ─────────────────\n');
  for (const [id, d] of Object.entries(results)) {
    if (d.confidence < 0.5) { console.log(`// ${id}: LOW (${d.confidence.toFixed(2)})`); continue; }
    console.log(`'${id}': { vertical: [${d.vertical.join(', ')}], horizontal: [${d.horizontal.join(', ')}], widthPercent: ${d.widthPercent} },`);
  }
}

main().catch(console.error);
