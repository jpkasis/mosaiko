import sharp from 'sharp';
import { GRID_CONFIGS, TILE_PRINT_SIZE } from '../../grid-config';
import {
  STD_FONT_PRINT_NAMES,
  type SaveTheDateCustomization,
  type STDAnchor,
  type STDSize,
} from '../../customization-types';
import type { SingleImagePrintJob, TileOutput } from '../types';
import { cropAndResize, splitIntoTiles } from '../utils/tile-splitter';

const TILE = TILE_PRINT_SIZE;

/**
 * Save the Date processor.
 *
 * The user's text is composited as a single unified overlay onto the
 * cropped photo BEFORE splitting into tiles. Each output tile naturally
 * receives its slice of the overlay. Font family, size, color, and
 * anchor position come from the customization.
 */
export async function processSaveTheDate(
  job: SingleImagePrintJob,
): Promise<TileOutput[]> {
  const customization = job.customization as SaveTheDateCustomization;
  const grid = GRID_CONFIGS[customization.gridSize];
  const compositeW = grid.cols * TILE;
  const compositeH = grid.rows * TILE;

  const croppedBuffer = await cropAndResize(
    job.imageBuffer,
    job.cropArea,
    compositeW,
    compositeH,
  );

  const overlaySvg = buildOverlaySvg(
    customization,
    compositeW,
    compositeH,
  );

  const composited = await sharp(croppedBuffer)
    .composite([{ input: Buffer.from(overlaySvg), blend: 'over' }])
    .png()
    .toBuffer();

  const tileBuffers = await splitIntoTiles(composited, grid.rows, grid.cols);

  return tileBuffers.map((buffer, index) => ({
    index,
    buffer,
    filename: `${job.jobId}_save-the-date_tile_${index}.png`,
  }));
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function formatDate(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const day = String(d.getUTCDate()).padStart(2, '0');
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const year = d.getUTCFullYear();
  return `${day}.${month}.${year}`;
}

// Event-text font size as a fraction of the composite short side.
const EVENT_SIZE_FRACTION: Record<STDSize, number> = {
  S: 0.055,
  M: 0.075,
  L: 0.095,
};

// Date font size as a fraction of the composite short side.
const DATE_SIZE_FRACTION: Record<STDSize, number> = {
  S: 0.03,
  M: 0.038,
  L: 0.047,
};

const EDGE_PAD = 0.08;

interface AnchorMath {
  x: number;
  textAnchor: 'start' | 'middle' | 'end';
  /** y for the TOP of the first line of text. */
  yTop: (totalHeight: number, H: number) => number;
}

function resolveAnchor(anchor: STDAnchor, W: number): AnchorMath {
  const [vert, horiz] = anchor.split('-') as [
    'top' | 'middle' | 'bottom',
    'left' | 'center' | 'right',
  ];

  const x =
    horiz === 'left'
      ? Math.round(W * EDGE_PAD)
      : horiz === 'right'
        ? Math.round(W * (1 - EDGE_PAD))
        : Math.round(W / 2);

  const textAnchor: 'start' | 'middle' | 'end' =
    horiz === 'left' ? 'start' : horiz === 'right' ? 'end' : 'middle';

  const yTop = (totalHeight: number, H: number): number => {
    if (vert === 'top') return Math.round(H * EDGE_PAD);
    if (vert === 'bottom') return Math.round(H * (1 - EDGE_PAD) - totalHeight);
    return Math.round(H / 2 - totalHeight / 2);
  };

  return { x, textAnchor, yTop };
}

function buildOverlaySvg(
  c: SaveTheDateCustomization,
  W: number,
  H: number,
): string {
  const shortSide = Math.min(W, H);
  const eventFontSize = Math.round(shortSide * EVENT_SIZE_FRACTION[c.fontSize]);
  const dateFontSize = Math.round(shortSide * DATE_SIZE_FRACTION[c.fontSize]);
  const eventLineHeight = Math.round(eventFontSize * 1.15);
  const dateLineHeight = Math.round(dateFontSize * 1.2);
  const gap = Math.round(shortSide * 0.015);

  const eventText = (c.eventText || 'Save the Date').trim();
  const dateText = formatDate(c.date);

  const totalHeight =
    eventLineHeight + (dateText ? gap + dateLineHeight : 0);

  const { x, textAnchor, yTop } = resolveAnchor(c.anchor, W);
  const startY = yTop(totalHeight, H);
  // SVG text baseline sits on y; raise by ~0.85 of fontSize so the visual top aligns.
  const eventBaselineY = startY + Math.round(eventFontSize * 0.85);
  const dateBaselineY = dateText
    ? eventBaselineY + (eventLineHeight - Math.round(eventFontSize * 0.85)) + gap + Math.round(dateFontSize * 0.85)
    : 0;

  const fontFamily = STD_FONT_PRINT_NAMES[c.fontFamily];
  const color = c.color;

  const dropShadow = `<filter id="stdShadow" x="-10%" y="-10%" width="120%" height="120%">
    <feDropShadow dx="0" dy="${Math.max(1, Math.round(eventFontSize * 0.04))}" stdDeviation="${Math.max(2, Math.round(eventFontSize * 0.08))}" flood-color="rgba(0,0,0,0.55)" />
  </filter>`;

  const eventEl = `<text x="${x}" y="${eventBaselineY}" font-family="${fontFamily}" font-size="${eventFontSize}" fill="${color}" text-anchor="${textAnchor}" letter-spacing="${Math.round(eventFontSize * 0.02)}">${escapeXml(eventText)}</text>`;

  const dateEl = dateText
    ? `<text x="${x}" y="${dateBaselineY}" font-family="${fontFamily}" font-size="${dateFontSize}" fill="${color}" text-anchor="${textAnchor}" letter-spacing="${Math.round(dateFontSize * 0.06)}" opacity="0.95">${escapeXml(dateText)}</text>`
    : '';

  return `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
    <defs>${dropShadow}</defs>
    <g filter="url(#stdShadow)">
      ${eventEl}
      ${dateEl}
    </g>
  </svg>`;
}
