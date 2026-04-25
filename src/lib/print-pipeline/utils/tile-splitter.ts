import sharp from 'sharp';
import { TILE_PRINT_SIZE } from '../../grid-config';
import type { CropArea } from '../../canvas-utils';

/**
 * Optional fit-mode + background overrides for `cropAndResize`. Without
 * an options object, the legacy default (Sharp `fit: 'fill'`) is used —
 * preserves the existing single-image processor behaviour. Tonos opts
 * in by passing `{ fitMode, background }` to honour the per-slot
 * fill/fit/stretch UI control (Phase 2 fix).
 *
 * UI-mode → Sharp-fit mapping:
 *   - `'fill'`    → `fit: 'cover'`   (preserve aspect, crop to fill)
 *   - `'fit'`     → `fit: 'contain'` (preserve aspect, letterbox)
 *   - `'stretch'` → `fit: 'fill'`    (non-uniform stretch)
 */
export interface CropAndResizeOptions {
  fitMode?: 'fill' | 'fit' | 'stretch';
  /** RGBA background colour for `'fit'` letterbox. Ignored otherwise. */
  background?: { r: number; g: number; b: number; alpha: number };
}

const FIT_MODE_TO_SHARP: Record<
  NonNullable<CropAndResizeOptions['fitMode']>,
  'cover' | 'contain' | 'fill'
> = {
  fill: 'cover',
  fit: 'contain',
  stretch: 'fill',
};

const DEFAULT_LETTERBOX_BG = { r: 239, g: 235, b: 224, alpha: 1 }; // --cream

/**
 * Crops the source image to the specified crop area, then resizes to the
 * target dimensions. Server-side equivalent of getCroppedCanvas.
 * Validates crop coordinates against actual image dimensions.
 */
export async function cropAndResize(
  imageBuffer: Buffer,
  cropArea: CropArea,
  width: number,
  height: number,
  options?: CropAndResizeOptions,
): Promise<Buffer> {
  // Validate crop coordinates against source image dimensions
  const metadata = await sharp(imageBuffer).metadata();
  const imgWidth = metadata.width ?? 0;
  const imgHeight = metadata.height ?? 0;

  const left = Math.max(0, Math.round(cropArea.x));
  const top = Math.max(0, Math.round(cropArea.y));
  let cropWidth = Math.round(cropArea.width);
  let cropHeight = Math.round(cropArea.height);

  // Clamp crop region to image bounds
  if (left + cropWidth > imgWidth) cropWidth = imgWidth - left;
  if (top + cropHeight > imgHeight) cropHeight = imgHeight - top;

  if (cropWidth <= 0 || cropHeight <= 0) {
    throw new Error(
      `[tile-splitter] Invalid crop area: region (${left},${top},${cropWidth},${cropHeight}) ` +
      `falls outside image bounds (${imgWidth}x${imgHeight})`,
    );
  }

  // Resolve Sharp `fit` from the optional UI-mode. Legacy callers (no
  // options object) keep the historic `fit: 'fill'` behaviour, which is
  // pixel-equivalent to `'cover'` whenever the cropArea aspect already
  // matches the target — true for the single-image processors today.
  const sharpFit = options?.fitMode
    ? FIT_MODE_TO_SHARP[options.fitMode]
    : 'fill';
  const background = options?.background ?? DEFAULT_LETTERBOX_BG;

  return sharp(imageBuffer)
    .extract({
      left,
      top,
      width: cropWidth,
      height: cropHeight,
    })
    .resize(width, height, {
      fit: sharpFit,
      // Sharp ignores `background` for `fill`; only `'contain'` uses it
      // (letterbox padding around the resized image).
      background,
      kernel: sharp.kernel.lanczos3,
    })
    .png()
    .toBuffer();
}

/**
 * Splits an image buffer into a grid of 827x827 tiles.
 *
 * 1. Resizes the full image to (cols * 827) x (rows * 827)
 * 2. Extracts each 827x827 tile left-to-right, top-to-bottom
 *
 * @param imageBuffer - Pre-cropped image buffer at print resolution
 * @param rows - Number of grid rows
 * @param cols - Number of grid columns
 * @returns Array of 827x827 PNG buffers, ordered left-to-right then top-to-bottom
 */
export async function splitIntoTiles(
  imageBuffer: Buffer,
  rows: number,
  cols: number,
): Promise<Buffer[]> {
  const totalWidth = cols * TILE_PRINT_SIZE;
  const totalHeight = rows * TILE_PRINT_SIZE;

  // Resize the full image to exact print dimensions
  const resizedBuffer = await sharp(imageBuffer)
    .resize(totalWidth, totalHeight, {
      fit: 'fill',
      kernel: sharp.kernel.lanczos3,
    })
    .png()
    .toBuffer();

  // Extract each tile
  const tiles: Buffer[] = [];

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const tileBuffer = await sharp(resizedBuffer)
        .extract({
          left: col * TILE_PRINT_SIZE,
          top: row * TILE_PRINT_SIZE,
          width: TILE_PRINT_SIZE,
          height: TILE_PRINT_SIZE,
        })
        .png()
        .toBuffer();

      tiles.push(tileBuffer);
    }
  }

  return tiles;
}

/**
 * Splits a pre-cropped image into a partial grid (e.g., 2x2 from a 3x2 grid).
 * Useful for processors that only need photo tiles from part of the grid.
 */
export async function splitIntoPartialTiles(
  imageBuffer: Buffer,
  rows: number,
  cols: number,
): Promise<Buffer[]> {
  return splitIntoTiles(imageBuffer, rows, cols);
}
