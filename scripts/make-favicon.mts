/**
 * Generate the Mosaiko favicon / app-icon set from the "M" mark on the brand
 * cream, matching the order-thumbnail look. Writes the Next.js App Router icon
 * conventions:
 *   - src/app/icon.png        (256, auto-linked as the favicon by Next)
 *   - src/app/icon1.svg       (scalable rounded tile for modern browsers)
 *   - src/app/apple-icon.png  (180, iOS home-screen)
 *   - src/app/favicon.ico     (opaque BMP/DIB 16/32/48, legacy fallback)
 *
 * Run: npx tsx scripts/make-favicon.mts
 */
import sharp from 'sharp';
import { readFile, writeFile } from 'node:fs/promises';
import { inflateSync } from 'node:zlib';

const CREAM = { r: 0xef, g: 0xeb, b: 0xe0, alpha: 1 }; // --cream #efebe0
const M = 'MOSAIKO-logos/M NEGRA.png'; // charcoal M mark, transparent bg
const M_VECTOR = 'MOSAIKO-logos/M NEGRO.pdf';
const MARK_FILL = '#373736';

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

async function bmpIcoImage(size: number, png: Buffer): Promise<Buffer> {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  if (info.width !== size || info.height !== size) {
    throw new Error(`Expected ${size}x${size} ICO tile, got ${info.width}x${info.height}`);
  }

  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0); // BITMAPINFOHEADER size
  header.writeInt32LE(size, 4);
  header.writeInt32LE(size * 2, 8); // XOR bitmap + AND mask heights
  header.writeUInt16LE(1, 12); // planes
  header.writeUInt16LE(32, 14); // bits per pixel
  header.writeUInt32LE(0, 16); // BI_RGB

  const xor = Buffer.alloc(size * size * 4);
  let offset = 0;
  for (let y = size - 1; y >= 0; y--) {
    for (let x = 0; x < size; x++) {
      const source = (y * size + x) * 4;
      xor[offset++] = data[source + 2]; // B
      xor[offset++] = data[source + 1]; // G
      xor[offset++] = data[source]; // R
      xor[offset++] = data[source + 3]; // A
    }
  }

  const maskStride = Math.ceil(size / 32) * 4;
  const andMask = Buffer.alloc(maskStride * size);
  header.writeUInt32LE(xor.length + andMask.length, 20);
  return Buffer.concat([header, xor, andMask]);
}

/** A multi-size .ico holding opaque BMP/DIB entries for maximum legacy compatibility. */
function buildIco(images: { size: number; data: Buffer }[]): Buffer {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: 1 = icon
  header.writeUInt16LE(images.length, 4);
  const entries: Buffer[] = [];
  let offset = 6 + images.length * 16;
  for (const { size, data } of images) {
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
  return Buffer.concat([header, ...entries, ...images.map((p) => p.data)]);
}

type SvgPathCommand =
  | { op: 'M' | 'L'; points: [number, number][] }
  | { op: 'C'; points: [number, number][] }
  | { op: 'Z'; points: [] };

function formatNumber(value: number): string {
  return Number(value.toFixed(3)).toString();
}

function decodeIllustratorContent(pdf: Buffer): string {
  const text = pdf.toString('latin1');
  const dictIndex = text.indexOf('/Filter/FlateDecode/Length');
  const streamIndex = text.indexOf('stream', dictIndex);
  if (dictIndex < 0 || streamIndex < 0) {
    throw new Error(`Could not find Illustrator vector stream in ${M_VECTOR}`);
  }

  let dataStart = streamIndex + 'stream'.length;
  if (pdf[dataStart] === 13 && pdf[dataStart + 1] === 10) dataStart += 2;
  else if (pdf[dataStart] === 10) dataStart += 1;

  const endIndex = text.indexOf('endstream', dataStart);
  let dataEnd = endIndex;
  while (pdf[dataEnd - 1] === 10 || pdf[dataEnd - 1] === 13) dataEnd--;
  return inflateSync(pdf.subarray(dataStart, dataEnd)).toString('utf8');
}

function readVisibleLayerCommands(content: string): SvgPathCommand[] {
  // The Illustrator PDF has two optional-content layers; MC1 is the visible
  // layer. MC0 is a hidden shifted copy and must not be included in the SVG.
  const visibleStart = content.indexOf('/OC /MC1 BDC');
  const visibleEnd = content.indexOf('EMC', visibleStart);
  const visible =
    visibleStart >= 0 && visibleEnd > visibleStart
      ? content.slice(visibleStart, visibleEnd)
      : content;

  const groups = visible.matchAll(/q\s+1 0 0 1 ([\d.-]+) ([\d.-]+) cm\s+([\s\S]*?)\s+f\s+Q/g);
  const commands: SvgPathCommand[] = [];

  for (const group of groups) {
    const tx = Number(group[1]);
    const ty = Number(group[2]);
    const tokens = group[3].match(/-?\d+(?:\.\d+)?|[mlch]/g) ?? [];
    const values: number[] = [];

    for (const token of tokens) {
      if (/^-?\d/.test(token)) {
        values.push(Number(token));
        continue;
      }

      if (token === 'h') {
        commands.push({ op: 'Z', points: [] });
        continue;
      }

      const count = token === 'c' ? 6 : 2;
      const raw = values.splice(0, count);
      const points: [number, number][] = [];
      for (let i = 0; i < raw.length; i += 2) {
        // Convert PDF user space (origin bottom-left) into SVG space.
        points.push([raw[i] + tx, 612 - (raw[i + 1] + ty)]);
      }
      commands.push({ op: token === 'c' ? 'C' : token === 'l' ? 'L' : 'M', points } as SvgPathCommand);
    }
  }

  if (commands.length === 0) {
    throw new Error(`Could not extract visible vector paths from ${M_VECTOR}`);
  }

  return commands;
}

async function iconSvg(size: number, ratio: number, radius: number): Promise<Buffer> {
  const commands = readVisibleLayerCommands(decodeIllustratorContent(await readFile(M_VECTOR)));
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const command of commands) {
    for (const [x, y] of command.points) {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }

  const markWidth = size * ratio;
  const scale = markWidth / (maxX - minX);
  const markHeight = (maxY - minY) * scale;
  const left = (size - markWidth) / 2;
  const top = (size - markHeight) / 2;
  const path = commands
    .map((command) => {
      if (command.op === 'Z') return 'Z';
      return `${command.op}${command.points
        .map(([x, y]) => `${formatNumber(left + (x - minX) * scale)} ${formatNumber(top + (y - minY) * scale)}`)
        .join(' ')}`;
    })
    .join('');

  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}"><rect width="${size}" height="${size}" rx="${formatNumber(
      size * radius,
    )}" fill="#efebe0"/><path d="${path}" fill="${MARK_FILL}"/></svg>\n`,
  );
}

// Corner radius as a fraction of the icon size (≈ iOS app-icon roundness).
const R = 0.2;

async function main() {
  await writeFile('src/app/icon.png', await tile(256, 0.74, R));
  await writeFile('src/app/icon1.svg', await iconSvg(256, 0.74, R));
  // apple-icon stays a full-bleed square — iOS applies its own rounded mask,
  // so pre-rounding here would leave a transparent gap at the corners.
  await writeFile('src/app/apple-icon.png', await tile(180, 0.7));
  // Small legacy ICO entries stay opaque to avoid alpha/ICO decoder quirks.
  // They use a slightly larger M (less padding) so they stay legible.
  const ico = buildIco([
    { size: 16, data: await bmpIcoImage(16, await tile(16, 0.88)) },
    { size: 32, data: await bmpIcoImage(32, await tile(32, 0.84)) },
    { size: 48, data: await bmpIcoImage(48, await tile(48, 0.8)) },
  ]);
  await writeFile('src/app/favicon.ico', ico);
  console.log(`✓ icon.png + icon1.svg + apple-icon.png + favicon.ico (${ico.length} B)`);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
