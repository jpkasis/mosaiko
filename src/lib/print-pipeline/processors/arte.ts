import sharp from 'sharp';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { TILE_PRINT_SIZE } from '../../grid-config';
import type { ArteCustomization } from '../../customization-types';
import type { SingleImagePrintJob, TileOutput } from '../types';
import { cropAndResize, splitIntoTiles } from '../utils/tile-splitter';

const TILE = TILE_PRINT_SIZE;
const LOGO_PATH = join(process.cwd(), 'public/logos/logo-blanco.png');

/**
 * Arte processor.
 * Layout is 4×2+1 (9 magnets total):
 *   - Tiles 0-7: photo split into 4 cols × 2 rows
 *   - Tile 8 (bottom-right): black info tile (museum label):
 *     Montserrat BOLD title, "Artist, c. Year" line, Mosaiko wordmark
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

// Wrap to at most 2 lines at a soft character budget. The Arte info tile
// padding leaves roughly 14 uppercase Montserrat-Bold chars per line at the
// chosen font size — beyond that we break on the last whitespace.
function wrapTitle(title: string, budget = 14): [string, string?] {
  const t = title.trim();
  if (t.length <= budget) return [t];
  const slice = t.slice(0, budget + 1);
  const lastSpace = slice.lastIndexOf(' ');
  if (lastSpace <= 0) return [t.slice(0, budget), t.slice(budget)];
  return [t.slice(0, lastSpace), t.slice(lastSpace + 1)];
}

async function renderInfoTile(
  title: string,
  artist: string,
  year: string,
): Promise<Buffer> {
  const [line1, line2] = wrapTitle(title.toUpperCase());
  const artistLine = year ? (artist ? `${artist}, c. ${year}` : `c. ${year}`) : artist;

  const titleX = Math.round(TILE * 0.12);
  const titleFontSize = Math.round(TILE * 0.105);
  const titleLineHeight = Math.round(titleFontSize * 1.12);
  const titleY1 = Math.round(TILE * 0.28);
  const titleY2 = titleY1 + titleLineHeight;

  const artistFontSize = Math.round(TILE * 0.072);
  const artistY = (line2 ? titleY2 : titleY1) + Math.round(TILE * 0.1);

  const titleTspans = line2
    ? `<tspan x="${titleX}" y="${titleY1}">${escapeXml(line1)}</tspan><tspan x="${titleX}" y="${titleY2}">${escapeXml(line2)}</tspan>`
    : `<tspan x="${titleX}" y="${titleY1}">${escapeXml(line1 ?? '')}</tspan>`;

  const svg = `<svg width="${TILE}" height="${TILE}" xmlns="http://www.w3.org/2000/svg">
    <rect width="${TILE}" height="${TILE}" fill="#000000" />
    <text font-family="Montserrat, sans-serif" font-size="${titleFontSize}" font-weight="700" fill="#FFFFFF" letter-spacing="1">${titleTspans}</text>
    <text x="${titleX}" y="${artistY}" font-family="Montserrat, sans-serif" font-size="${artistFontSize}" font-weight="400" fill="#CCCCCC">${escapeXml(artistLine)}</text>
  </svg>`;

  const baseBuffer = await sharp(Buffer.from(svg))
    .resize(TILE, TILE)
    .png()
    .toBuffer();

  const logoHeight = Math.round(TILE * 0.085);
  const resizedLogo = await sharp(await readFile(LOGO_PATH))
    .resize({ height: logoHeight })
    .png()
    .toBuffer();

  const logoMeta = await sharp(resizedLogo).metadata();
  const logoWidth = logoMeta.width ?? Math.round(logoHeight * 2.83);
  const logoLeft = Math.round((TILE - logoWidth) / 2);
  const logoTop = Math.round(TILE * 0.82);

  return sharp(baseBuffer)
    .composite([{ input: resizedLogo, left: logoLeft, top: logoTop }])
    .png()
    .toBuffer();
}
