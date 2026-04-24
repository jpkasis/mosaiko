import { GRID_CONFIGS } from '../../grid-config';
import type { SingleImagePrintJob, TileOutput } from '../types';
import { cropAndResize, splitIntoTiles } from '../utils/tile-splitter';

/**
 * Mosaicos processor — the simplest pipeline.
 * Crops the image to the user's selection, then splits into grid tiles.
 * No text overlays, no filters, no special tiles.
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
  );

  // Step 2: Split the cropped image into 827x827 tiles
  const tileBuffers = await splitIntoTiles(croppedBuffer, rows, cols);

  // Step 3: Map to TileOutput with filenames
  return tileBuffers.map((buffer, index) => ({
    index,
    buffer,
    filename: `${job.jobId}_mosaicos_tile_${index}.png`,
  }));
}
