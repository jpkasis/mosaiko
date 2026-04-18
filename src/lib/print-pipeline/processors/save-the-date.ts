import sharp from 'sharp';
import { GRID_CONFIGS, TILE_PRINT_SIZE } from '../../grid-config';
import {
  STD_FONT_PRINT_NAMES,
  hexLuminance,
  type SaveTheDateCustomization,
  type STDAnchor,
  type STDSize,
  type STDTextTreatment,
} from '../../customization-types';
import type { SingleImagePrintJob, TileOutput } from '../types';
import { cropAndResize, splitIntoTiles } from '../utils/tile-splitter';

const TILE = TILE_PRINT_SIZE;

/**
 * Save the Date processor.
 *
 * The user's text is composited as a single unified overlay onto the
 * cropped photo BEFORE splitting into tiles. Each tile naturally
 * receives its slice of the overlay. Font family, size, color, anchor,
 * and readability treatment come from the customization.
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

  const composited = await applyTextOverlay(
    croppedBuffer,
    customization,
    compositeW,
    compositeH,
  );

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

const EVENT_SIZE_FRACTION: Record<STDSize, number> = {
  S: 0.055,
  M: 0.075,
  L: 0.095,
};

const DATE_SIZE_FRACTION: Record<STDSize, number> = {
  S: 0.03,
  M: 0.038,
  L: 0.047,
};

const EDGE_PAD = 0.08;

interface AnchorMath {
  x: number;
  textAnchor: 'start' | 'middle' | 'end';
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

interface TextLayout {
  eventText: string;
  dateText: string;
  eventFontSize: number;
  dateFontSize: number;
  eventLineHeight: number;
  dateLineHeight: number;
  gap: number;
  totalHeight: number;
  // Left edge and width of the tightest bounding box enclosing both lines.
  boxLeft: number;
  boxTop: number;
  boxWidth: number;
  boxHeight: number;
  // Anchor-resolved baselines.
  eventBaselineY: number;
  dateBaselineY: number;
  x: number;
  textAnchor: 'start' | 'middle' | 'end';
}

function computeTextLayout(
  c: SaveTheDateCustomization,
  W: number,
  H: number,
): TextLayout {
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
  const boxTop = yTop(totalHeight, H);
  const eventBaselineY = boxTop + Math.round(eventFontSize * 0.85);
  const dateBaselineY = dateText
    ? eventBaselineY + (eventLineHeight - Math.round(eventFontSize * 0.85)) + gap + Math.round(dateFontSize * 0.85)
    : 0;

  // Text width estimate. Cormorant/Playfair/Montserrat average ≈ 0.55 × fontSize
  // for the 400 weight we're using. Bold-ish fonts (Cinzel) lean ~0.6; we use a
  // conservative 0.58 to avoid panels that under-cover. Script fonts (Dancing
  // Script, Great Vibes) are wider; bump to 0.62.
  const fontCharWidth = c.fontFamily === 'dancing-script' || c.fontFamily === 'great-vibes'
    ? 0.62
    : c.fontFamily === 'cinzel'
      ? 0.58
      : 0.55;
  const eventWidth = Math.round(eventFontSize * fontCharWidth * eventText.length);
  const dateWidth = dateText ? Math.round(dateFontSize * 0.55 * dateText.length) : 0;
  const boxWidth = Math.max(eventWidth, dateWidth);

  const boxLeft =
    textAnchor === 'start'
      ? x
      : textAnchor === 'end'
        ? x - boxWidth
        : Math.round(x - boxWidth / 2);

  return {
    eventText,
    dateText,
    eventFontSize,
    dateFontSize,
    eventLineHeight,
    dateLineHeight,
    gap,
    totalHeight,
    boxLeft,
    boxTop,
    boxWidth,
    boxHeight: totalHeight,
    eventBaselineY,
    dateBaselineY,
    x,
    textAnchor,
  };
}

async function applyTextOverlay(
  photo: Buffer,
  c: SaveTheDateCustomization,
  W: number,
  H: number,
): Promise<Buffer> {
  const layout = computeTextLayout(c, W, H);
  const fontFamily = STD_FONT_PRINT_NAMES[c.fontFamily];
  const color = c.color;
  const textIsLight = hexLuminance(color) >= 0.6;

  // Treatment 1: frosted — blur a photo region behind the text first.
  let base = photo;
  if (c.treatment === 'frosted') {
    base = await compositeFrostedPanel(photo, layout, textIsLight, c.fontSize, W, H);
  }

  const overlaySvg = buildOverlaySvg(c, layout, fontFamily, color, textIsLight, W, H);

  return sharp(base)
    .composite([{ input: Buffer.from(overlaySvg), blend: 'over' }])
    .png()
    .toBuffer();
}

async function compositeFrostedPanel(
  photo: Buffer,
  layout: TextLayout,
  textIsLight: boolean,
  size: STDSize,
  W: number,
  H: number,
): Promise<Buffer> {
  const padX = Math.round(layout.eventFontSize * 0.5);
  const padY = Math.round(layout.eventFontSize * 0.35);
  const left = Math.max(0, layout.boxLeft - padX);
  const top = Math.max(0, layout.boxTop - padY);
  const right = Math.min(W, layout.boxLeft + layout.boxWidth + padX);
  const bottom = Math.min(H, layout.boxTop + layout.boxHeight + padY);
  const width = Math.max(1, right - left);
  const height = Math.max(1, bottom - top);

  const blurRadius = size === 'S' ? 10 : size === 'L' ? 24 : 16;
  const tint = textIsLight
    ? { r: 20, g: 20, b: 24, alpha: 0.32 }
    : { r: 250, g: 248, b: 244, alpha: 0.45 };

  const region = await sharp(photo)
    .extract({ left, top, width, height })
    .blur(blurRadius)
    .toBuffer();

  const tintBuffer = await sharp({
    create: {
      width,
      height,
      channels: 4,
      background: tint,
    },
  })
    .png()
    .toBuffer();

  const tintedRegion = await sharp(region)
    .composite([{ input: tintBuffer, blend: 'over' }])
    .png()
    .toBuffer();

  return sharp(photo)
    .composite([{ input: tintedRegion, left, top }])
    .png()
    .toBuffer();
}

function buildOverlaySvg(
  c: SaveTheDateCustomization,
  layout: TextLayout,
  fontFamily: string,
  color: string,
  textIsLight: boolean,
  W: number,
  H: number,
): string {
  const {
    eventText,
    dateText,
    eventFontSize,
    dateFontSize,
    boxLeft,
    boxTop,
    boxWidth,
    boxHeight,
    eventBaselineY,
    dateBaselineY,
    x,
    textAnchor,
  } = layout;

  const treatment: STDTextTreatment = c.treatment;
  const strokeColor = textIsLight ? 'rgba(0,0,0,0.75)' : 'rgba(255,255,255,0.85)';

  // Panel rectangle (for `panel` and to match `frosted` on top of the blurred region).
  const panelRect = (() => {
    if (treatment !== 'panel' && treatment !== 'frosted') return '';
    const padX = Math.round(eventFontSize * 0.5);
    const padY = Math.round(eventFontSize * 0.35);
    const left = Math.max(0, boxLeft - padX);
    const top = Math.max(0, boxTop - padY);
    const right = Math.min(W, boxLeft + boxWidth + padX);
    const bottom = Math.min(H, boxTop + boxHeight + padY);
    const width = Math.max(1, right - left);
    const height = Math.max(1, bottom - top);

    if (treatment === 'panel') {
      const fill = textIsLight ? 'rgba(20,20,24,0.55)' : 'rgba(250,248,244,0.7)';
      return `<rect x="${left}" y="${top}" width="${width}" height="${height}" rx="2" fill="${fill}" />`;
    }
    // Frosted's blurred+tinted region is already composited beneath; the SVG
    // panel would double-dim it, so emit nothing here.
    return '';
  })();

  const dropShadowFilter = treatment === 'shadow'
    ? `<filter id="stdShadow" x="-10%" y="-10%" width="120%" height="120%">
        <feDropShadow dx="0" dy="${Math.max(1, Math.round(eventFontSize * 0.05))}" stdDeviation="${Math.max(2, Math.round(eventFontSize * 0.1))}" flood-color="rgba(0,0,0,0.75)" />
        <feDropShadow dx="0" dy="0" stdDeviation="${Math.max(1, Math.round(eventFontSize * 0.03))}" flood-color="rgba(0,0,0,0.45)" />
      </filter>`
    : '';

  const strokeAttrs = treatment === 'outline'
    ? ` stroke="${strokeColor}" stroke-width="${Math.max(1, Math.round(eventFontSize * 0.045))}" paint-order="stroke fill"`
    : '';

  const dateStrokeAttrs = treatment === 'outline'
    ? ` stroke="${strokeColor}" stroke-width="${Math.max(1, Math.round(dateFontSize * 0.045))}" paint-order="stroke fill"`
    : '';

  const filterRef = treatment === 'shadow' ? ` filter="url(#stdShadow)"` : '';

  const eventEl = `<text x="${x}" y="${eventBaselineY}" font-family="${fontFamily}" font-size="${eventFontSize}" fill="${color}" text-anchor="${textAnchor}" letter-spacing="${Math.round(eventFontSize * 0.02)}"${strokeAttrs}>${escapeXml(eventText)}</text>`;

  const dateEl = dateText
    ? `<text x="${x}" y="${dateBaselineY}" font-family="${fontFamily}" font-size="${dateFontSize}" fill="${color}" text-anchor="${textAnchor}" letter-spacing="${Math.round(dateFontSize * 0.06)}" opacity="0.95"${dateStrokeAttrs}>${escapeXml(dateText)}</text>`
    : '';

  return `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
    <defs>${dropShadowFilter}</defs>
    ${panelRect}
    <g${filterRef}>
      ${eventEl}
      ${dateEl}
    </g>
  </svg>`;
}
