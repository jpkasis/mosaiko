/**
 * Generate the Mosaiko favicon / app-icon set from the "M" mark on the brand
 * cream, matching the order-thumbnail look. Writes the Next.js App Router icon
 * conventions:
 *   - src/app/icon.png        (256, auto-linked as the favicon by Next)
 *   - src/app/apple-icon.png  (180, iOS home-screen)
 *   - src/app/favicon.ico     (PNG-encoded 16/32/48 — small, legacy/compat)
 *
 * Run: npx tsx scripts/make-favicon.mts
 */
import sharp from 'sharp';
import { writeFile } from 'node:fs/promises';

const CREAM = { r: 0xef, g: 0xeb, b: 0xe0, alpha: 1 }; // --cream #efebe0
const M = 'MOSAIKO-logos/M NEGRA.png'; // charcoal M mark, transparent bg

/**
 * A cream tile with the M centered at `ratio` of the tile width. When
 * `radius` (a fraction of the tile size) is > 0 the corners are rounded —
 * they become transparent via a rounded-rect `dest-in` mask, so the icon reads
 * as a rounded square on any tab/background.
 */
async function tile(size: number, ratio: number, radius = 0): Promise<Buffer> {
  const m = await sharp(M).resize({ width: Math.round(size * ratio) }).png().toBuffer();
  const meta = await sharp(m).metadata();
  const left = Math.round((size - (meta.width ?? 0)) / 2);
  const top = Math.round((size - (meta.height ?? 0)) / 2);
  const square = await sharp({
    create: { width: size, height: size, channels: 4, background: CREAM },
  })
    .composite([{ input: m, left, top }])
    .png()
    .toBuffer();
  if (radius <= 0) return square;
  const r = Math.round(size * radius);
  const mask = Buffer.from(
    `<svg width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${r}" ry="${r}" fill="#fff"/></svg>`,
  );
  return sharp(square)
    .composite([{ input: mask, blend: 'dest-in' }])
    .png()
    .toBuffer();
}

/** A minimal multi-size .ico holding PNG-encoded entries (supported since Vista,
 *  all modern browsers). Far smaller than a 32-bit-bitmap ICO. */
function buildIco(pngs: { size: number; data: Buffer }[]): Buffer {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: 1 = icon
  header.writeUInt16LE(pngs.length, 4);
  const entries: Buffer[] = [];
  let offset = 6 + pngs.length * 16;
  for (const { size, data } of pngs) {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0); // width (0 means 256)
    e.writeUInt8(size >= 256 ? 0 : size, 1); // height
    e.writeUInt8(0, 2); // color palette
    e.writeUInt8(0, 3); // reserved
    e.writeUInt16LE(1, 4); // color planes
    e.writeUInt16LE(32, 6); // bits per pixel
    e.writeUInt32LE(data.length, 8); // image size
    e.writeUInt32LE(offset, 12); // image offset
    entries.push(e);
    offset += data.length;
  }
  return Buffer.concat([header, ...entries, ...pngs.map((p) => p.data)]);
}

// Corner radius as a fraction of the icon size (≈ iOS app-icon roundness).
const R = 0.2;

async function main() {
  await writeFile('src/app/icon.png', await tile(256, 0.74, R));
  // apple-icon stays a full-bleed square — iOS applies its own rounded mask,
  // so pre-rounding here would leave a transparent gap at the corners.
  await writeFile('src/app/apple-icon.png', await tile(180, 0.7));
  // Small sizes get a slightly larger M (less padding) so they stay legible.
  const ico = buildIco([
    { size: 16, data: await tile(16, 0.88, R) },
    { size: 32, data: await tile(32, 0.84, R) },
    { size: 48, data: await tile(48, 0.8, R) },
  ]);
  await writeFile('src/app/favicon.ico', ico);
  console.log(`✓ icon.png + apple-icon.png + favicon.ico (${ico.length} B)`);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
