import sharp from 'sharp';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { TILE_PRINT_SIZE } from '../../grid-config';
import type { GhibliCustomization } from '../../customization-types';
import type { SingleImagePrintJob, TileOutput } from '../types';
import { cropAndResize } from '../utils/tile-splitter';

const TILE = TILE_PRINT_SIZE;
const TEMPLATE_DIR = join(process.cwd(), 'mosaic-categories/studio/studio-template-PNGs');
const SRC_SIZE = 615;

// Transparent area bounds per photo tile (measured from PNGs at 615px)
const PHOTO_AREAS = [
  { left: 87, top: 88, right: 615, bottom: 614 },   // tile 1: frame on top+left
  { left: 0, top: 88, right: 527, bottom: 614 },     // tile 2: frame on top+right
  { left: 87, top: 0, right: 615, bottom: 615 },     // tile 3: frame on left only
  { left: 0, top: 0, right: 527, bottom: 615 },      // tile 4: frame on right only
] as const;

/**
 * Studio/Ghibli processor — PNG template overlays + text panels.
 *
 * Grid is always 6 (3 rows x 2 cols):
 *   - Top 4 tiles: photo within PNG frame (cream + teal border)
 *   - Bottom 2 tiles: PNG panel bg + composited text
 */
export async function processGhibli(job: SingleImagePrintJob): Promise<TileOutput[]> {
  const customization = job.customization as GhibliCustomization;
  const { year, japaneseText, customText, studioText } = customization;

  const scale = TILE / SRC_SIZE;

  // Calculate visible photo area across the 4 tiles
  const colLeftW = 615 - 87;  // 528
  const colRightW = 527;
  const rowTopH = 614 - 88;   // 526
  const rowBotH = 615;
  const stripH = 63;           // photo extends 63px into text panel tiles (5-6)

  const printPhotoW = Math.round((colLeftW + colRightW) * scale);
  const printPhotoH = Math.round((rowTopH + rowBotH + stripH) * scale);

  // Crop user photo to match visible area
  const croppedBuffer = await cropAndResize(
    job.imageBuffer,
    job.cropArea,
    printPhotoW,
    printPhotoH,
  );

  // Extract each tile's photo portion and composite with PNG frame
  const photoTiles = await Promise.all(
    PHOTO_AREAS.map(async (area, index) => {
      const areaW = area.right - area.left;
      const areaH = area.bottom - area.top;
      const printAreaW = Math.round(areaW * scale);
      const printAreaH = Math.round(areaH * scale);

      const col = index % 2;
      const row = Math.floor(index / 2);
      const extractLeft = col === 0 ? 0 : Math.round(colLeftW * scale);
      const extractTop = row === 0 ? 0 : Math.round(rowTopH * scale);

      const photoBuffer = await sharp(croppedBuffer)
        .extract({ left: extractLeft, top: extractTop, width: printAreaW, height: printAreaH })
        .png()
        .toBuffer();

      // Load frame template
      const templateBuffer = await readFile(join(TEMPLATE_DIR, `${index + 1}.png`));
      const resizedTemplate = await sharp(templateBuffer)
        .resize(TILE, TILE, { fit: 'fill' })
        .png()
        .toBuffer();

      // Create blank tile with cream bg
      const blankTile = await sharp({
        create: { width: TILE, height: TILE, channels: 4, background: { r: 237, g: 232, b: 224, alpha: 255 } },
      }).png().toBuffer();

      const photoLeft = Math.round(area.left * scale);
      const photoTop = Math.round(area.top * scale);

      return sharp(blankTile)
        .composite([
          { input: photoBuffer, left: photoLeft, top: photoTop },
          { input: resizedTemplate },
        ])
        .png()
        .toBuffer();
    }),
  );

  // Extract the 63-unit photo strip that extends into the top of tiles 5 & 6.
  const stripWLeft = Math.round(colLeftW * scale);
  const stripWRight = Math.round(colRightW * scale);
  const stripHpx = Math.round(stripH * scale);
  const stripTop = Math.round((rowTopH + rowBotH) * scale);

  const leftStripBuffer = await sharp(croppedBuffer)
    .extract({ left: 0, top: stripTop, width: stripWLeft, height: stripHpx })
    .png()
    .toBuffer();
  const rightStripBuffer = await sharp(croppedBuffer)
    .extract({ left: stripWLeft, top: stripTop, width: stripWRight, height: stripHpx })
    .png()
    .toBuffer();

  // Generate text panels (tiles 5 and 6)
  const leftPanelBuffer = await renderLeftPanel(year, studioText, leftStripBuffer);
  const rightPanelBuffer = await renderRightPanel(japaneseText, customText, rightStripBuffer);

  return [
    ...photoTiles.map((buffer, index) => ({
      index,
      buffer,
      filename: `${job.jobId}_ghibli_tile_${index}.png`,
    })),
    { index: 4, buffer: leftPanelBuffer, filename: `${job.jobId}_ghibli_tile_4.png` },
    { index: 5, buffer: rightPanelBuffer, filename: `${job.jobId}_ghibli_tile_5.png` },
  ];
}

async function renderLeftPanel(
  year: string,
  studioText: string | undefined,
  photoStrip: Buffer,
): Promise<Buffer> {
  const templateBuffer = await readFile(join(TEMPLATE_DIR, '5.png'));
  const resizedTemplate = await sharp(templateBuffer)
    .resize(TILE, TILE, { fit: 'fill' })
    .png()
    .toBuffer();

  // Cream base (matches the template body colour so the strip edges blend).
  const baseBuffer = await sharp({
    create: { width: TILE, height: TILE, channels: 4, background: { r: 235, g: 234, b: 230, alpha: 255 } },
  }).png().toBuffer();

  // Photo strip is inset from the left by 14.146% (87/615) to match the
  // transparent region of template 5.
  const photoLeft = Math.round((87 / SRC_SIZE) * TILE);

  const textX = Math.round(TILE * 0.07);
  const yearY = Math.round(TILE * 0.325);
  const studioY = Math.round(TILE * 0.405);

  const textSvg = `<svg width="${TILE}" height="${TILE}" xmlns="http://www.w3.org/2000/svg">
    <text x="${textX}" y="${yearY}" font-family="Montserrat, sans-serif" font-size="58" fill="#2a2a2a">${escapeXml(year)}</text>
    <text x="${textX}" y="${studioY}" font-family="Montserrat, sans-serif" font-size="58" fill="#2a2a2a">${escapeXml(studioText || 'STUDIO GHIBLI')}</text>
  </svg>`;

  const textBuffer = await sharp(Buffer.from(textSvg)).resize(TILE, TILE).png().toBuffer();

  return sharp(baseBuffer)
    .composite([
      { input: photoStrip, left: photoLeft, top: 0 },
      { input: resizedTemplate },
      { input: textBuffer },
    ])
    .png()
    .toBuffer();
}

async function renderRightPanel(
  japaneseText: string,
  customText: string,
  photoStrip: Buffer,
): Promise<Buffer> {
  const templateBuffer = await readFile(join(TEMPLATE_DIR, '6.png'));
  const resizedTemplate = await sharp(templateBuffer)
    .resize(TILE, TILE, { fit: 'fill' })
    .png()
    .toBuffer();

  const baseBuffer = await sharp({
    create: { width: TILE, height: TILE, channels: 4, background: { r: 235, g: 234, b: 230, alpha: 255 } },
  }).png().toBuffer();

  // Right panel's transparent region starts at x=0.
  const photoLeft = 0;

  const textRight = Math.round(TILE * 0.93);
  const jpY = Math.round(TILE * 0.325);
  const titleY = Math.round(TILE * 0.415);

  const textSvg = `<svg width="${TILE}" height="${TILE}" xmlns="http://www.w3.org/2000/svg">
    <text x="${textRight}" y="${jpY}" font-family="sans-serif" font-size="58" fill="#2a2a2a" text-anchor="end">${escapeXml(japaneseText)}</text>
    <text x="${textRight}" y="${titleY}" font-family="Montserrat, sans-serif" font-size="58" font-weight="bold" fill="#2a2a2a" text-anchor="end">${escapeXml(customText)}</text>
  </svg>`;

  const textBuffer = await sharp(Buffer.from(textSvg)).resize(TILE, TILE).png().toBuffer();

  return sharp(baseBuffer)
    .composite([
      { input: photoStrip, left: photoLeft, top: 0 },
      { input: resizedTemplate },
      { input: textBuffer },
    ])
    .png()
    .toBuffer();
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
