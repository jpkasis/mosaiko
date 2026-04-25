import { TILE_PRINT_SIZE, type GridConfig } from './grid-config';

export interface CropArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Loads an image from a URL/data URL and returns an HTMLImageElement.
 */
export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

/**
 * Gets the cropped region of the source image as a canvas.
 * When rotation is non-zero, the image is rotated first and the crop
 * coordinates are applied to the rotated result (matching react-easy-crop output).
 */
export function getCroppedCanvas(
  image: HTMLImageElement,
  cropArea: CropArea,
  outputWidth: number,
  outputHeight: number,
  rotation: number = 0,
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = outputWidth;
  canvas.height = outputHeight;
  const ctx = canvas.getContext('2d')!;

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  if (rotation === 0) {
    ctx.drawImage(
      image,
      cropArea.x,
      cropArea.y,
      cropArea.width,
      cropArea.height,
      0,
      0,
      outputWidth,
      outputHeight,
    );
    return canvas;
  }

  // Rotate the full image onto a temp canvas, then crop from it
  const radians = (rotation * Math.PI) / 180;
  const sin = Math.abs(Math.sin(radians));
  const cos = Math.abs(Math.cos(radians));
  const { naturalWidth: w, naturalHeight: h } = image;

  const rotW = Math.round(w * cos + h * sin);
  const rotH = Math.round(w * sin + h * cos);

  const rotCanvas = document.createElement('canvas');
  rotCanvas.width = rotW;
  rotCanvas.height = rotH;
  const rotCtx = rotCanvas.getContext('2d')!;

  rotCtx.translate(rotW / 2, rotH / 2);
  rotCtx.rotate(radians);
  rotCtx.drawImage(image, -w / 2, -h / 2);

  ctx.drawImage(
    rotCanvas,
    cropArea.x,
    cropArea.y,
    cropArea.width,
    cropArea.height,
    0,
    0,
    outputWidth,
    outputHeight,
  );

  rotCanvas.width = 0;
  rotCanvas.height = 0;

  return canvas;
}

/**
 * Fit-aware variant of `getCroppedCanvas` for Tonos slot previews.
 *
 * Mirrors the server pipeline's `cropAndResize({ fitMode, background })`
 * semantics so the live preview drawer matches the printed magnet:
 *   - `'fill'`    → cover crop (preserve aspect, crop overflow)
 *   - `'fit'`     → contain on a cream canvas (preserve aspect, letterbox)
 *   - `'stretch'` → non-uniform stretch (cropArea pixels → square output)
 *
 * Cream default `#efebe0` matches `--cream` and the printer-side
 * `TONOS_LETTERBOX_BG` so preview ↔ print parity holds.
 */
export function getCroppedTileWithFit(
  image: HTMLImageElement,
  cropArea: CropArea,
  size: number,
  fitMode: 'fill' | 'fit' | 'stretch',
  rotation: number = 0,
  background: string = '#efebe0',
): HTMLCanvasElement {
  if (fitMode === 'stretch') {
    return getCroppedCanvas(image, cropArea, size, size, rotation);
  }

  const nativeW = Math.max(1, Math.round(cropArea.width));
  const nativeH = Math.max(1, Math.round(cropArea.height));
  const nativeCanvas = getCroppedCanvas(image, cropArea, nativeW, nativeH, rotation);

  const out = document.createElement('canvas');
  out.width = size;
  out.height = size;
  const ctx = out.getContext('2d')!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  const aspect = nativeW / nativeH;
  let drawW: number;
  let drawH: number;

  if (fitMode === 'fill') {
    if (aspect > 1) {
      drawH = size;
      drawW = size * aspect;
    } else {
      drawW = size;
      drawH = size / aspect;
    }
  } else {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, size, size);
    if (aspect > 1) {
      drawW = size;
      drawH = size / aspect;
    } else {
      drawH = size;
      drawW = size * aspect;
    }
  }

  const dx = (size - drawW) / 2;
  const dy = (size - drawH) / 2;
  ctx.drawImage(nativeCanvas, dx, dy, drawW, drawH);

  nativeCanvas.width = 0;
  nativeCanvas.height = 0;

  return out;
}

/**
 * Splits a cropped image into grid tiles for printing.
 * Each tile is TILE_PRINT_SIZE × TILE_PRINT_SIZE pixels (7cm at 300dpi).
 * Returns an array of data URLs ordered left-to-right, top-to-bottom.
 */
export function splitImageIntoTiles(
  image: HTMLImageElement,
  cropArea: CropArea,
  grid: GridConfig,
  rotation: number = 0,
): string[] {
  const totalWidth = grid.cols * TILE_PRINT_SIZE;
  const totalHeight = grid.rows * TILE_PRINT_SIZE;

  // First, get the full cropped image at print resolution
  const fullCanvas = getCroppedCanvas(image, cropArea, totalWidth, totalHeight, rotation);
  const fullCtx = fullCanvas.getContext('2d')!;

  const tiles: string[] = [];

  for (let row = 0; row < grid.rows; row++) {
    for (let col = 0; col < grid.cols; col++) {
      const tileCanvas = document.createElement('canvas');
      tileCanvas.width = TILE_PRINT_SIZE;
      tileCanvas.height = TILE_PRINT_SIZE;
      const tileCtx = tileCanvas.getContext('2d')!;

      tileCtx.imageSmoothingEnabled = true;
      tileCtx.imageSmoothingQuality = 'high';

      tileCtx.drawImage(
        fullCanvas,
        col * TILE_PRINT_SIZE,
        row * TILE_PRINT_SIZE,
        TILE_PRINT_SIZE,
        TILE_PRINT_SIZE,
        0,
        0,
        TILE_PRINT_SIZE,
        TILE_PRINT_SIZE,
      );

      tiles.push(tileCanvas.toDataURL('image/jpeg', 0.95));
    }
  }

  // Clean up
  fullCanvas.width = 0;
  fullCanvas.height = 0;

  return tiles;
}


/**
 * Validates image resolution for print quality.
 * Returns 'good' | 'medium' | 'low' based on the effective DPI
 * the image would achieve at the selected grid size.
 */
export function assessImageQuality(
  imageWidth: number,
  imageHeight: number,
  grid: GridConfig,
): 'good' | 'medium' | 'low' {
  const requiredWidth = grid.cols * TILE_PRINT_SIZE;
  const requiredHeight = grid.rows * TILE_PRINT_SIZE;

  const widthRatio = imageWidth / requiredWidth;
  const heightRatio = imageHeight / requiredHeight;
  const ratio = Math.min(widthRatio, heightRatio);

  if (ratio >= 0.8) return 'good';
  if (ratio >= 0.5) return 'medium';
  return 'low';
}
