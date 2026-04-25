import { createCanvas, type SKRSContext2D } from '@napi-rs/canvas';
import type { TextRenderOptions } from '../types';
import { ensurePrintFontsRegistered } from './font-loader';

// ─── Phase 4 — canvas-backed text rendering ────────────────────────────────
//
// Pre-Phase-4 these helpers built SVG <text> strings and handed them to
// Sharp/librsvg. Vercel's Node runtime has no Google Fonts in
// fontconfig → librsvg fell back to DejaVu/Liberation Sans → printed
// magnet diverged from the cropper preview. The Phase 4.0 spike
// (`scripts/font-spike.mts`) confirmed librsvg ignores embedded
// `@font-face` data URIs, so the only cross-platform path is to render
// text on a separate canvas (which has its own font registry) and
// composite the resulting PNG via Sharp.
//
// Both `renderTextToBuffer` (single-text-block) and
// `renderMultiTextToBuffer` (multiple positioned text blocks) keep
// their pre-Phase-4 signatures; only the internals switched to canvas.
// Processors that built SVG <text> inline are migrated separately to
// the new `renderTextLayer` API below.

/**
 * Per-text specification for `renderTextLayer`. Maps to a single
 * `ctx.fillText` call (plus optional stroke for outlined text).
 *
 * Coordinate system is canvas-pixel-space relative to the layer's
 * top-left; `align`/`baseline` work the same as the SVG text-anchor /
 * dominant-baseline attributes processors used pre-Phase-4.
 */
export interface TextSpec {
  text: string;
  x: number;
  y: number;
  /** Font-family name as registered in `font-loader.ts`. Must match
   *  exactly — no fallback chain. */
  fontFamily: string;
  fontSize: number;
  fontWeight?: 400 | 700;
  /** Fill color (CSS-compatible). Default `#FFFFFF`. */
  fill?: string;
  /** Horizontal alignment (CSS canvas `textAlign`). Default `'start'`. */
  align?: 'start' | 'center' | 'end';
  /** Vertical baseline (CSS canvas `textBaseline`). Default `'alphabetic'`. */
  baseline?: 'top' | 'middle' | 'alphabetic' | 'bottom' | 'hanging';
  /** Per-spec opacity 0..1. Default 1. Implemented via `globalAlpha`. */
  opacity?: number;
  /** Tracking in pixels (CSS `letter-spacing`). Default 0. */
  letterSpacing?: number;
  /** Optional outline stroke. */
  stroke?: { color: string; width: number };
}

export interface RenderTextLayerOptions {
  width: number;
  height: number;
  /** CSS color or `'transparent'`. Default transparent so the layer
   *  composites cleanly over a photo or template. */
  background?: string;
  texts: TextSpec[];
}

/**
 * Renders a transparent PNG of `width × height` with the supplied
 * text specs drawn via canvas. Canvas's font registry (populated by
 * `font-loader.ts`) provides the actual glyph outlines — no librsvg
 * fontconfig dependency. The PNG is suitable for Sharp.composite()
 * over a photo, template, or other layer.
 *
 * Always idempotently registers the print fonts before rendering, so
 * processors don't need to remember to wire up the loader.
 */
export async function renderTextLayer(options: RenderTextLayerOptions): Promise<Buffer> {
  ensurePrintFontsRegistered();
  const { width, height, background, texts } = options;

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  if (background && background !== 'transparent') {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, width, height);
  }

  // Subpixel hinting for crisp text — canvas defaults are decent but
  // explicit doesn't hurt on rasterized text at print resolution.
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  for (const spec of texts) {
    drawText(ctx, spec);
  }

  return canvas.toBuffer('image/png');
}

function drawText(ctx: SKRSContext2D, spec: TextSpec): void {
  const {
    text, x, y, fontFamily, fontSize,
    fontWeight = 400,
    fill = '#FFFFFF',
    align = 'start',
    baseline = 'alphabetic',
    opacity = 1,
    letterSpacing = 0,
    stroke,
  } = spec;

  // Font shorthand: `<weight> <size>px "<family>"`. Quoting the family
  // tolerates spaces (`Playfair Display`).
  ctx.font = `${fontWeight} ${fontSize}px "${fontFamily}"`;
  ctx.textAlign = align;
  ctx.textBaseline = baseline;
  ctx.globalAlpha = opacity;
  // letterSpacing on @napi-rs/canvas accepts a CSS `<length>` string.
  // 0 is a no-op; non-zero applies tracking before rendering each glyph.
  ctx.letterSpacing = `${letterSpacing}px`;

  if (stroke && stroke.width > 0) {
    ctx.strokeStyle = stroke.color;
    ctx.lineWidth = stroke.width;
    ctx.lineJoin = 'round';
    ctx.miterLimit = 2;
    ctx.strokeText(text, x, y);
  }

  ctx.fillStyle = fill;
  ctx.fillText(text, x, y);

  // Reset globalAlpha so it doesn't leak into the next spec.
  ctx.globalAlpha = 1;
}

/**
 * Calculates the X position for text based on alignment and padding.
 */
function getTextX(
  width: number,
  align: TextRenderOptions['align'],
  padding: number,
): number {
  switch (align) {
    case 'left':
      return padding;
    case 'right':
      return width - padding;
    case 'center':
    default:
      return width / 2;
  }
}

/**
 * Renders text to a PNG buffer via canvas (Phase 4 — was SVG/librsvg).
 * Single-text-block API kept for backward compatibility with the
 * pre-Phase-4 callers; new code should use `renderTextLayer` directly.
 */
export async function renderTextToBuffer(
  options: TextRenderOptions,
): Promise<Buffer> {
  const {
    text,
    width,
    height,
    fontSize,
    fontFamily = 'sans-serif',
    color = '#FFFFFF',
    backgroundColor,
    align = 'center',
    verticalAlign = 'middle',
    padding = 20,
  } = options;

  const textX = getTextX(width, align, padding);
  // Multi-line: each \n becomes a separate TextSpec at incremented y.
  const lines = text.split('\n');
  const lineHeight = fontSize * 1.3;
  const totalTextHeight = lines.length * lineHeight;
  let startY: number;
  if (verticalAlign === 'middle') {
    startY = (height - totalTextHeight) / 2 + fontSize;
  } else if (verticalAlign === 'top') {
    startY = padding + fontSize;
  } else {
    startY = height - padding - totalTextHeight + fontSize;
  }

  const canvasAlign: TextSpec['align'] =
    align === 'left' ? 'start' : align === 'right' ? 'end' : 'center';

  const texts: TextSpec[] = lines.map((line, i) => ({
    text: line,
    x: textX,
    y: startY + i * lineHeight,
    fontFamily,
    fontSize,
    fill: color,
    align: canvasAlign,
  }));

  return renderTextLayer({ width, height, background: backgroundColor, texts });
}

/**
 * Renders multiple text blocks onto a single tile (canvas, Phase 4).
 * Backward-compatible wrapper over `renderTextLayer`.
 */
export async function renderMultiTextToBuffer(
  blocks: Array<{
    text: string;
    x: number;
    y: number;
    fontSize: number;
    color?: string;
    fontFamily?: string;
    anchor?: 'start' | 'middle' | 'end';
  }>,
  width: number,
  height: number,
  backgroundColor: string,
): Promise<Buffer> {
  const texts: TextSpec[] = blocks.map((b) => ({
    text: b.text,
    x: b.x,
    y: b.y,
    fontFamily: b.fontFamily ?? 'Source Sans 3',
    fontSize: b.fontSize,
    fill: b.color ?? '#FFFFFF',
    // Map SVG-style `middle` to canvas-style `center`. Other values
    // (`start`, `end`) are the same in both APIs.
    align: b.anchor === 'middle' ? 'center' : (b.anchor ?? 'center'),
  }));
  return renderTextLayer({ width, height, background: backgroundColor, texts });
}

