import sharp from 'sharp';
import { createCanvas, type SKRSContext2D } from '@napi-rs/canvas';
import { GRID_CONFIGS, TILE_PRINT_SIZE } from '../../grid-config';
import {
  STD_FONT_PRINT_NAMES,
  hexLuminance,
  type SaveTheDateCustomization,
  type STDAnchor,
  type STDSize,
  type STDTextTreatment,
  type STDTextIntensity,
} from '../../customization-types';
import type { SingleImagePrintJob, TileOutput } from '../types';
import { cropAndResize, splitIntoTiles } from '../utils/tile-splitter';
import { ensurePrintFontsRegistered } from '../utils/font-loader';

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

  // Phase 4 STD migration: text + treatment effects rendered via
  // @napi-rs/canvas instead of SVG/librsvg. The SVG path silently fell
  // back to DejaVu/Liberation Sans on Vercel because Google Fonts
  // aren't installed in the runtime fontconfig — preview ↔ print
  // diverged on every STD purchase. Canvas has its own font registry
  // (font-loader.ts) so the printed text matches the cropper preview.
  const overlay = await renderSaveTheDateOverlay(
    customization,
    compositeW,
    compositeH,
  );

  const composited = await sharp(croppedBuffer)
    .composite([{ input: overlay, blend: 'over' }])
    .png()
    .toBuffer();

  const tileBuffers = await splitIntoTiles(composited, grid.rows, grid.cols);

  return tileBuffers.map((buffer, index) => ({
    index,
    buffer,
    filename: `${job.jobId}_save-the-date_tile_${index}.png`,
  }));
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

/**
 * Phase 4 STD migration — canvas-based overlay renderer.
 *
 * Replaces the SVG/librsvg path with @napi-rs/canvas. The font registry
 * (`font-loader.ts`) provides the actual glyph outlines so the printed
 * STD magnet matches the cropper preview. The 5 SVG <filter> treatments
 * are reproduced via canvas primitives:
 *   - 'none'    : plain fillText
 *   - 'outline' : strokeText + fillText (paint-order: stroke fill)
 *   - 'shadow'  : two passes — ambient (no offset) + drop (offset down).
 *                 ctx.shadow{Color,Blur,OffsetY} applies per draw call.
 *   - 'halo'    : two blur passes via ctx.filter='blur(Npx)' rendering
 *                 the text in halo color, then sharp text on top.
 *   - 'card'    : filled rect with shadow + inner stroke rect; text on top.
 *   - 'frame'   : two stroked rects (outer + inner); text on top.
 *
 * Returns a transparent PNG that Sharp.composite() blends over the
 * cropped photo (same call site as the SVG path; only the buffer
 * source changed).
 */
async function renderSaveTheDateOverlay(
  c: SaveTheDateCustomization,
  W: number,
  H: number,
): Promise<Buffer> {
  ensurePrintFontsRegistered();
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  const layout = computeTextLayout(c, W, H);
  const fontFamily = STD_FONT_PRINT_NAMES[c.fontFamily];
  const color = c.color;
  const textIsLight = hexLuminance(color) >= 0.6;
  const treatment: STDTextTreatment = c.treatment;

  drawTreatmentBacking(ctx, treatment, textIsLight, layout, W, H);
  drawTreatmentText(
    ctx,
    layout,
    fontFamily,
    color,
    treatment,
    textIsLight,
    c.intensity,
  );

  return canvas.toBuffer('image/png');
}

function drawTreatmentBacking(
  ctx: SKRSContext2D,
  treatment: STDTextTreatment,
  textIsLight: boolean,
  layout: TextLayout,
  W: number,
  H: number,
): void {
  if (
    treatment === 'none' ||
    treatment === 'shadow' ||
    treatment === 'outline' ||
    treatment === 'halo'
  ) {
    return;
  }

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

  if (treatment === 'card') {
    const fill = textIsLight ? 'rgba(22,22,26,0.88)' : 'rgba(250,248,242,0.94)';
    const innerStroke = textIsLight ? 'rgba(255,255,255,0.22)' : 'rgba(0,0,0,0.18)';
    const innerInset = Math.round(Math.max(4, layout.eventFontSize * 0.12));

    // Drop shadow via canvas's per-draw shadow API. The SVG version
    // used feDropShadow with offset+blur; canvas's ctx.shadow* applies
    // identically when set BEFORE fillRect. Reset after the fill so
    // subsequent draws (text, inner stroke) don't inherit it.
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.22)';
    ctx.shadowOffsetY = Math.max(2, Math.round(layout.eventFontSize * 0.08));
    ctx.shadowBlur = Math.max(4, Math.round(layout.eventFontSize * 0.18));
    ctx.fillStyle = fill;
    ctx.fillRect(x, y, w, h);
    ctx.restore();

    // Inner border (no shadow).
    ctx.save();
    ctx.strokeStyle = innerStroke;
    ctx.lineWidth = 1;
    ctx.strokeRect(
      x + innerInset,
      y + innerInset,
      Math.max(1, w - innerInset * 2),
      Math.max(1, h - innerInset * 2),
    );
    ctx.restore();
    return;
  }

  if (treatment === 'frame') {
    const outerStroke = textIsLight ? 'rgba(255,255,255,0.75)' : 'rgba(30,28,24,0.75)';
    const innerStroke = textIsLight ? 'rgba(255,255,255,0.45)' : 'rgba(30,28,24,0.45)';
    const innerInset = Math.round(Math.max(4, layout.eventFontSize * 0.14));

    ctx.save();
    ctx.strokeStyle = outerStroke;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x, y, w, h);
    ctx.strokeStyle = innerStroke;
    ctx.lineWidth = 1;
    ctx.strokeRect(
      x + innerInset,
      y + innerInset,
      Math.max(1, w - innerInset * 2),
      Math.max(1, h - innerInset * 2),
    );
    ctx.restore();
    return;
  }
}

const SHADOW_INTENSITY_MULT: Record<STDTextIntensity, number> = {
  subtle: 0.55,
  medium: 1.0,
  intense: 1.85,
};

function drawTreatmentText(
  ctx: SKRSContext2D,
  layout: TextLayout,
  fontFamily: string,
  color: string,
  treatment: STDTextTreatment,
  textIsLight: boolean,
  intensity: STDTextIntensity,
): void {
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

  // Canvas TextAlign uses 'start'|'center'|'end'; the SVG text-anchor
  // 'middle' maps to canvas 'center'. Other values are identical.
  const canvasAlign: 'start' | 'center' | 'end' =
    textAnchor === 'middle' ? 'center' : textAnchor;
  const dateBaselineY =
    firstEventBaselineY +
    eventLines.length * eventLineHeight +
    gap +
    Math.round(dateFontSize * 0.82) -
    Math.round(eventFontSize * 0.82);

  const eventLetterSpacing = Math.round(eventFontSize * 0.02);
  const dateLetterSpacing = Math.round(dateFontSize * 0.06);
  const strokeColor = textIsLight ? 'rgba(0,0,0,0.8)' : 'rgba(255,255,255,0.9)';
  const mult = SHADOW_INTENSITY_MULT[intensity];

  // Closure — draws ALL event lines + the date in the supplied state.
  // Used by treatments that need multiple passes (shadow, halo).
  function paintAll(passColor: string, passOpacity = 1): void {
    ctx.save();
    ctx.textAlign = canvasAlign;
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = passColor;
    ctx.globalAlpha = passOpacity;
    // Event lines
    ctx.font = `${eventFontSize}px ${fontFamily}`;
    ctx.letterSpacing = `${eventLetterSpacing}px`;
    eventLines.forEach((line, i) => {
      const y = firstEventBaselineY + i * eventLineHeight;
      ctx.fillText(line, textX, y);
    });
    // Date line
    if (dateText) {
      ctx.font = `${dateFontSize}px ${fontFamily}`;
      ctx.letterSpacing = `${dateLetterSpacing}px`;
      ctx.globalAlpha = passOpacity * 0.92;
      ctx.fillText(dateText, textX, dateBaselineY);
    }
    ctx.restore();
  }

  // 'shadow' — two stacked drop shadows (drop + ambient) baked into
  // canvas's per-draw shadow state. SVG version stacked two
  // <feDropShadow> elements; canvas re-renders the text twice with
  // different shadow params. The text glyphs from the second pass
  // overlap pixel-for-pixel with the first; the visual effect is the
  // text in `color` over the union of both shadows.
  if (treatment === 'shadow') {
    const dy = Math.max(2, Math.round(eventFontSize * 0.06 * mult));
    const blurBig = Math.max(3, Math.round(eventFontSize * 0.12 * mult));
    const blurSmall = Math.max(1, Math.round(eventFontSize * 0.04 * mult));
    const shadowColorBig = `rgba(0,0,0,${Math.min(0.9, 0.55 + 0.12 * mult).toFixed(2)})`;
    const shadowColorSmall = `rgba(0,0,0,${Math.min(0.7, 0.35 + 0.08 * mult).toFixed(2)})`;

    // Pass 1: drop shadow (offset + larger blur).
    ctx.save();
    ctx.shadowColor = shadowColorBig;
    ctx.shadowOffsetY = dy;
    ctx.shadowBlur = blurBig;
    paintAll(color);
    ctx.restore();

    // Pass 2: ambient shadow (no offset, smaller blur). Text re-renders
    // at the same position so the user-color text wins; only the new
    // ambient shadow is added under the existing pass-1 output.
    ctx.save();
    ctx.shadowColor = shadowColorSmall;
    ctx.shadowOffsetY = 0;
    ctx.shadowBlur = blurSmall;
    paintAll(color);
    ctx.restore();
    return;
  }

  // 'halo' — render text in halo color through two blur radii, then
  // sharp text on top. ctx.filter='blur(Npx)' affects subsequent draws;
  // reset between passes.
  if (treatment === 'halo') {
    const haloFlood = textIsLight ? 'rgba(0,0,0,0.85)' : 'rgba(255,255,255,0.9)';
    const innerBlur = Math.max(4, Math.round(eventFontSize * 0.1 * mult));
    const outerBlur = Math.max(8, Math.round(eventFontSize * 0.22 * mult));

    ctx.save();
    ctx.filter = `blur(${outerBlur}px)`;
    paintAll(haloFlood);
    ctx.restore();
    ctx.save();
    ctx.filter = `blur(${innerBlur}px)`;
    paintAll(haloFlood);
    ctx.restore();
    // Sharp text on top.
    paintAll(color);
    return;
  }

  // 'outline' — strokeText + fillText. paint-order: stroke fill in the
  // SVG version puts the stroke UNDER the fill; canvas does the same
  // when strokeText is called before fillText.
  if (treatment === 'outline') {
    const eventStrokeWidth = Math.max(1, Math.round(eventFontSize * 0.045));
    const dateStrokeWidth = Math.max(1, Math.round(dateFontSize * 0.045));

    ctx.save();
    ctx.textAlign = canvasAlign;
    ctx.textBaseline = 'alphabetic';
    ctx.lineJoin = 'round';
    ctx.miterLimit = 2;

    // Event lines: stroke under fill.
    ctx.font = `${eventFontSize}px ${fontFamily}`;
    ctx.letterSpacing = `${eventLetterSpacing}px`;
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = eventStrokeWidth;
    ctx.fillStyle = color;
    eventLines.forEach((line, i) => {
      const y = firstEventBaselineY + i * eventLineHeight;
      ctx.strokeText(line, textX, y);
      ctx.fillText(line, textX, y);
    });

    // Date line: same pattern, smaller stroke + fixed opacity 0.92.
    if (dateText) {
      ctx.font = `${dateFontSize}px ${fontFamily}`;
      ctx.letterSpacing = `${dateLetterSpacing}px`;
      ctx.lineWidth = dateStrokeWidth;
      ctx.globalAlpha = 0.92;
      ctx.strokeText(dateText, textX, dateBaselineY);
      ctx.fillText(dateText, textX, dateBaselineY);
    }
    ctx.restore();
    return;
  }

  // 'none' / 'card' / 'frame' — plain text on top (backing already
  // drawn by drawTreatmentBacking).
  paintAll(color);
}
