import sharp from 'sharp';
import { readFile } from 'node:fs/promises';
import { GRID_CONFIGS } from '../../grid-config';
import { SHARED_LOGOS } from '../asset-paths';
import type { SingleImagePrintJob, TileOutput } from '../types';
import { cropAndResize, splitIntoTiles } from '../utils/tile-splitter';

const TILE = 827; // 7cm at 300dpi (matches TILE_PRINT_SIZE)

// PR-C: the single-tile (1 pieza) Mosaico carries the white Mosaiko logo,
// bottom-right — a touch SMALLER than other categories (which use 0.08) so the
// lone magnet stays photo-first. Other Mosaicos sizes stamp no logo.
const SINGLE_TILE_LOGO_HEIGHT_RATIO = 0.06;

async function stampSingleTileLogo(tile: Buffer): Promise<Buffer> {
  const logoHeight = Math.round(TILE * SINGLE_TILE_LOGO_HEIGHT_RATIO);
  const resizedLogo = await sharp(await readFile(SHARED_LOGOS.blanco))
    .resize({ height: logoHeight })
    .png()
    .toBuffer();
  const logoMeta = await sharp(resizedLogo).metadata();
  const logoWidth = logoMeta.width ?? Math.round(logoHeight * 2.83);
  const logoLeft = TILE - logoWidth - Math.round(TILE * 0.06);
  const logoTop = TILE - logoHeight - Math.round(TILE * 0.05);
  return sharp(tile)
    .composite([{ input: resizedLogo, left: logoLeft, top: logoTop }])
    .png()
    .toBuffer();
}

/**
 * Mosaicos processor — the simplest pipeline.
 * Crops the image to the user's selection, then splits into grid tiles.
 * No text overlays or filters; the single-tile (1) variant gets a small
 * Mosaiko logo (PR-C).
 */
export async function processMosaicos(job: SingleImagePrintJob): Promise<TileOutput[]> {
  const grid = GRID_CONFIGS[job.customization.gridSize];

  // Respect the rotated layout: the builder's `useBuilderFlow` swaps
  // rows/cols and inverts the cropper aspect when `layoutRotated` is
  // true, so the `cropArea` we receive is already in the rotated
  // proportions. Apply the same swap to the print target dimensions
  // and the tile-split math, otherwise a portrait-rotated Mosaico 6
  // gets squeezed back into landscape at print time.
  const mosaicos =
    job.customization.categoryType === 'mosaicos'
      ? job.customization
      : null;
  const rotated = mosaicos?.layoutRotated === true;
  const rows = rotated ? grid.cols : grid.rows;
  const cols = rotated ? grid.rows : grid.cols;

  // Step 1: Crop the image to the user's selected area
  const croppedBuffer = await cropAndResize(
    job.imageBuffer,
    job.cropArea,
    cols * 827,
    rows * 827,
    { rotation: job.imageRotation ?? 0 },
  );

  // Step 2: Split the cropped image into 827x827 tiles
  const tileBuffers = await splitIntoTiles(croppedBuffer, rows, cols);

  // Step 2b (PR-C): brand the single-tile magnet. gridSize 1 → exactly one
  // tile; stamp the small Mosaiko logo so both the cart preview and the print
  // (same shared pipeline) carry it.
  const branded =
    job.customization.gridSize === 1
      ? [await stampSingleTileLogo(tileBuffers[0])]
      : tileBuffers;

  // Step 3: Map to TileOutput with filenames
  return branded.map((buffer, index) => ({
    index,
    buffer,
    filename: `${job.jobId}_mosaicos_tile_${index}.png`,
  }));
}
