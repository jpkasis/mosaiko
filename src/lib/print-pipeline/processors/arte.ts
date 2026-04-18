import sharp from 'sharp';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { TILE_PRINT_SIZE } from '../../grid-config';
import type { ArteCustomization } from '../../customization-types';
import type { SingleImagePrintJob, TileOutput } from '../types';
import { cropAndResize, splitIntoTiles } from '../utils/tile-splitter';
import { wrapTitle, wrapArtist } from '../utils/text-wrap';

const TILE = TILE_PRINT_SIZE;
const LOGO_PATH = join(process.cwd(), 'public/logos/logo-blanco.png');

/**
 * Arte processor.
 * Layout is 4×2+1 (9 magnets total):
 *   - Tiles 0-7: photo split into 4 cols × 2 rows
 *   - Tile 8 (bottom-right): black "museum label" info tile:
 *     Montserrat Bold title + "Artist, c. Year" line, right-aligned in
 *     the upper portion; Mosaiko wordmark tucked in the bottom-right corner.
 */
export async function processArte(job: SingleImagePrintJob): Promise<TileOutput[]> {
  const customization = job.customization as ArteCustomization;
  const { title, artist, year } = customization;

  const croppedBuffer = await cropAndResize(
    job.imageBuffer,
    job.cropArea,
    4 * TILE,
    2 * TILE,
  );

  const allTiles = await splitIntoTiles(croppedBuffer, 2, 4);

  const infoTileBuffer = await renderInfoTile(title, artist, year);

  const tiles: TileOutput[] = [];

  for (let i = 0; i < 8; i++) {
    tiles.push({
      index: i,
      buffer: allTiles[i],
      filename: `${job.jobId}_arte_tile_${i}.png`,
    });
  }

  tiles.push({
    index: 8,
    buffer: infoTileBuffer,
    filename: `${job.jobId}_arte_tile_8.png`,
  });

  return tiles;
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

async function renderInfoTile(
  title: string,
  artist: string,
  year: string,
): Promise<Buffer> {
  const trimmedTitle = title.trim();
  const trimmedArtist = artist.trim();
  const trimmedYear = year.trim();
  const titleLines = wrapTitle(trimmedTitle);
  const artistRaw = trimmedYear
    ? trimmedArtist
      ? `${trimmedArtist}, c. ${trimmedYear}`
      : `c. ${trimmedYear}`
    : trimmedArtist;
  const artistLines = wrapArtist(artistRaw);

  const textRightX = Math.round(TILE * 0.90);
  const titleFontSize = Math.round(TILE * 0.08);
  const titleLineHeight = Math.round(titleFontSize * 1.1);
  const titleStartY = Math.round(TILE * 0.10 + titleFontSize * 0.9);

  const artistFontSize = Math.round(TILE * 0.06);
  const artistLineHeight = Math.round(artistFontSize * 1.25);
  const gapBetween = Math.round(TILE * 0.02);
  const artistStartY =
    titleStartY + (titleLines.length - 1) * titleLineHeight + gapBetween + artistFontSize;

  const titleTspans = titleLines
    .map(
      (line, i) =>
        `<tspan x="${textRightX}" y="${titleStartY + i * titleLineHeight}">${escapeXml(line)}</tspan>`,
    )
    .join('');

  const artistTspans = artistLines
    .map(
      (line, i) =>
        `<tspan x="${textRightX}" y="${artistStartY + i * artistLineHeight}">${escapeXml(line)}</tspan>`,
    )
    .join('');

  const svg = `<svg width="${TILE}" height="${TILE}" xmlns="http://www.w3.org/2000/svg">
    <rect width="${TILE}" height="${TILE}" fill="#000000" />
    <text font-family="Montserrat, sans-serif" font-size="${titleFontSize}" font-weight="700" fill="#FFFFFF" text-anchor="end" letter-spacing="0.8">${titleTspans}</text>
    <text font-family="Montserrat, sans-serif" font-size="${artistFontSize}" font-weight="400" fill="#E5E5E5" text-anchor="end">${artistTspans}</text>
  </svg>`;

  const baseBuffer = await sharp(Buffer.from(svg))
    .resize(TILE, TILE)
    .png()
    .toBuffer();

  const logoHeight = Math.round(TILE * 0.08);
  const resizedLogo = await sharp(await readFile(LOGO_PATH))
    .resize({ height: logoHeight })
    .png()
    .toBuffer();

  const logoMeta = await sharp(resizedLogo).metadata();
  const logoWidth = logoMeta.width ?? Math.round(logoHeight * 2.83);
  const logoLeft = TILE - logoWidth - Math.round(TILE * 0.08);
  const logoTop = TILE - logoHeight - Math.round(TILE * 0.06);

  return sharp(baseBuffer)
    .composite([{ input: resizedLogo, left: logoLeft, top: logoTop }])
    .png()
    .toBuffer();
}
