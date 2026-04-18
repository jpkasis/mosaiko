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
 * cropped photo BEFORE splitting into tiles. Each output PNG tile
 * naturally receives its slice of the overlay.
 *
 * Text wrapping is user-controlled: eventText is split on '\n' only.
 * No automatic word-breaking.
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

  const overlaySvg = buildOverlaySvg(customization, compositeW, compositeH);

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

const EDGE_PAD = 0.06;

interface TextLayout {
  eventLines: string[];
  dateText: string;
  eventFontSize: number;
  dateFontSize: number;
  eventLineHeight: number;
  dateLineHeight: number;
  gap: number;
  textBlockHeight: number;
  textBlockWidth: number;
  // Anchor-resolved position of the tightest text bounding box.
  blockLeft: number;
  blockTop: number;
  // Baseline y of the first event text line.
  firstEventBaselineY: number;
  textX: number;
  textAnchor: 'start' | 'middle' | 'end';
  // Inner padding applied inside card/frame rectangles.
  boxPadX: number;
  boxPadY: number;
}

function charWidthFactor(fontFamily: SaveTheDateCustomization['fontFamily']): number {
  if (fontFamily === 'dancing-script' || fontFamily === 'great-vibes') return 0.62;
  if (fontFamily === 'cinzel') return 0.58;
  return 0.55;
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
  const gap = Math.round(shortSide * 0.02);

  const rawEvent = c.eventText.length > 0 ? c.eventText : 'Save the Date';
  const eventLines = rawEvent.split('\n');
  const dateText = formatDate(c.date);

  const textBlockHeight =
    eventLines.length * eventLineHeight +
    (dateText ? gap + dateLineHeight : 0);

  const cwFactor = charWidthFactor(c.fontFamily);
  const eventWidth = Math.max(
    ...eventLines.map((line) => Math.round(eventFontSize * cwFactor * Math.max(1, line.length))),
  );
  const dateWidth = dateText
    ? Math.round(dateFontSize * cwFactor * dateText.length)
    : 0;
  const textBlockWidth = Math.max(eventWidth, dateWidth);

  const [vert, horiz] = c.anchor.split('-') as [
    'top' | 'middle' | 'bottom',
    'left' | 'center' | 'right',
  ];

  const boxPadX = Math.round(eventFontSize * 0.55);
  const boxPadY = Math.round(eventFontSize * 0.42);

  // Distinguish the text-block left edge from the visual box (card/frame) edge.
  // The anchor positions the visual box, so the text inside starts boxPadX in.
  const needsBox = c.treatment === 'card' || c.treatment === 'frame';
  const boxWidth = needsBox ? textBlockWidth + boxPadX * 2 : textBlockWidth;
  const boxHeight = needsBox ? textBlockHeight + boxPadY * 2 : textBlockHeight;

  const boxLeft =
    horiz === 'left'
      ? Math.round(W * EDGE_PAD)
      : horiz === 'right'
        ? Math.round(W * (1 - EDGE_PAD)) - boxWidth
        : Math.round((W - boxWidth) / 2);

  const boxTop =
    vert === 'top'
      ? Math.round(H * EDGE_PAD)
      : vert === 'bottom'
        ? Math.round(H * (1 - EDGE_PAD)) - boxHeight
        : Math.round((H - boxHeight) / 2);

  const blockLeft = needsBox ? boxLeft + boxPadX : boxLeft;
  const blockTop = needsBox ? boxTop + boxPadY : boxTop;

  const textX =
    horiz === 'left'
      ? blockLeft
      : horiz === 'right'
        ? blockLeft + textBlockWidth
        : blockLeft + Math.round(textBlockWidth / 2);
  const textAnchor: 'start' | 'middle' | 'end' =
    horiz === 'left' ? 'start' : horiz === 'right' ? 'end' : 'middle';

  const firstEventBaselineY = blockTop + Math.round(eventFontSize * 0.82);

  return {
    eventLines,
    dateText,
    eventFontSize,
    dateFontSize,
    eventLineHeight,
    dateLineHeight,
    gap,
    textBlockHeight,
    textBlockWidth,
    blockLeft,
    blockTop,
    firstEventBaselineY,
    textX,
    textAnchor,
    boxPadX,
    boxPadY,
  };
}

function buildOverlaySvg(
  c: SaveTheDateCustomization,
  W: number,
  H: number,
): string {
  const layout = computeTextLayout(c, W, H);
  const fontFamily = STD_FONT_PRINT_NAMES[c.fontFamily];
  const color = c.color;
  const textIsLight = hexLuminance(color) >= 0.6;
  const treatment: STDTextTreatment = c.treatment;

  // Build SVG pieces.
  const { defs, backing } = buildTreatmentBacking(treatment, textIsLight, layout, W, H);
  const textGroup = buildTextGroup(
    layout,
    fontFamily,
    color,
    treatment,
    textIsLight,
  );

  return `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
    <defs>${defs}</defs>
    ${backing}
    ${textGroup}
  </svg>`;
}

function buildTreatmentBacking(
  treatment: STDTextTreatment,
  textIsLight: boolean,
  layout: TextLayout,
  W: number,
  H: number,
): { defs: string; backing: string } {
  const padX = layout.boxPadX;
  const padY = layout.boxPadY;
  const boxLeft = layout.blockLeft - padX;
  const boxTop = layout.blockTop - padY;
  const boxWidth = layout.textBlockWidth + padX * 2;
  const boxHeight = layout.textBlockHeight + padY * 2;
  const clipLeft = Math.max(0, boxLeft);
  const clipTop = Math.max(0, boxTop);
  const clipRight = Math.min(W, boxLeft + boxWidth);
  const clipBottom = Math.min(H, boxTop + boxHeight);
  const x = clipLeft;
  const y = clipTop;
  const w = Math.max(1, clipRight - clipLeft);
  const h = Math.max(1, clipBottom - clipTop);

  switch (treatment) {
    case 'none':
    case 'shadow':
    case 'outline':
      return { defs: '', backing: '' };

    case 'card': {
      const fill = textIsLight ? 'rgba(22,22,26,0.88)' : 'rgba(250,248,242,0.94)';
      const innerStroke = textIsLight ? 'rgba(255,255,255,0.22)' : 'rgba(0,0,0,0.18)';
      const innerInset = Math.round(Math.max(4, layout.eventFontSize * 0.12));
      const shadowFilter = `<filter id="cardShadow" x="-20%" y="-20%" width="140%" height="140%">
        <feDropShadow dx="0" dy="${Math.max(2, Math.round(layout.eventFontSize * 0.08))}" stdDeviation="${Math.max(4, Math.round(layout.eventFontSize * 0.18))}" flood-color="rgba(0,0,0,0.22)" />
      </filter>`;
      const outerRect = `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}" filter="url(#cardShadow)" />`;
      const innerRect = `<rect x="${x + innerInset}" y="${y + innerInset}" width="${Math.max(1, w - innerInset * 2)}" height="${Math.max(1, h - innerInset * 2)}" fill="none" stroke="${innerStroke}" stroke-width="1" />`;
      return { defs: shadowFilter, backing: `${outerRect}${innerRect}` };
    }

    case 'frame': {
      const outerStroke = textIsLight ? 'rgba(255,255,255,0.75)' : 'rgba(30,28,24,0.75)';
      const innerStroke = textIsLight ? 'rgba(255,255,255,0.45)' : 'rgba(30,28,24,0.45)';
      const innerInset = Math.round(Math.max(4, layout.eventFontSize * 0.14));
      const outerRect = `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="${outerStroke}" stroke-width="1.5" />`;
      const innerRect = `<rect x="${x + innerInset}" y="${y + innerInset}" width="${Math.max(1, w - innerInset * 2)}" height="${Math.max(1, h - innerInset * 2)}" fill="none" stroke="${innerStroke}" stroke-width="1" />`;
      return { defs: '', backing: `${outerRect}${innerRect}` };
    }
  }
}

function buildTextGroup(
  layout: TextLayout,
  fontFamily: string,
  color: string,
  treatment: STDTextTreatment,
  textIsLight: boolean,
): string {
  const {
    eventLines,
    dateText,
    eventFontSize,
    dateFontSize,
    eventLineHeight,
    firstEventBaselineY,
    gap,
    textX,
    textAnchor,
  } = layout;

  const strokeColor = textIsLight ? 'rgba(0,0,0,0.8)' : 'rgba(255,255,255,0.9)';
  const outlineAttrs =
    treatment === 'outline'
      ? ` stroke="${strokeColor}" stroke-width="${Math.max(1, Math.round(eventFontSize * 0.045))}" paint-order="stroke fill"`
      : '';
  const dateOutlineAttrs =
    treatment === 'outline'
      ? ` stroke="${strokeColor}" stroke-width="${Math.max(1, Math.round(dateFontSize * 0.045))}" paint-order="stroke fill"`
      : '';

  const shadowFilterId = 'stdShadow';
  const shadowFilterAttr = treatment === 'shadow' ? ` filter="url(#${shadowFilterId})"` : '';

  const eventTspans = eventLines
    .map((line, i) => {
      const y = firstEventBaselineY + i * eventLineHeight;
      return `<tspan x="${textX}" y="${y}">${escapeXml(line)}</tspan>`;
    })
    .join('');

  const eventEl = `<text font-family="${fontFamily}" font-size="${eventFontSize}" fill="${color}" text-anchor="${textAnchor}" letter-spacing="${Math.round(eventFontSize * 0.02)}"${outlineAttrs}>${eventTspans}</text>`;

  const dateBaselineY =
    firstEventBaselineY + eventLines.length * eventLineHeight + gap + Math.round(dateFontSize * 0.82) - Math.round(eventFontSize * 0.82);
  const dateEl = dateText
    ? `<text x="${textX}" y="${dateBaselineY}" font-family="${fontFamily}" font-size="${dateFontSize}" fill="${color}" text-anchor="${textAnchor}" letter-spacing="${Math.round(dateFontSize * 0.06)}" opacity="0.92"${dateOutlineAttrs}>${escapeXml(dateText)}</text>`
    : '';

  if (treatment === 'shadow') {
    return `<defs><filter id="${shadowFilterId}" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="${Math.max(2, Math.round(eventFontSize * 0.06))}" stdDeviation="${Math.max(3, Math.round(eventFontSize * 0.12))}" flood-color="rgba(0,0,0,0.65)" />
      <feDropShadow dx="0" dy="0" stdDeviation="${Math.max(1, Math.round(eventFontSize * 0.04))}" flood-color="rgba(0,0,0,0.4)" />
    </filter></defs><g${shadowFilterAttr}>${eventEl}${dateEl}</g>`;
  }

  return `<g>${eventEl}${dateEl}</g>`;
}
