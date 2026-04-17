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

  // Step 1: Crop the image to the user's selected area
  const croppedBuffer = await cropAndResize(
    job.imageBuffer,
    job.cropArea,
    grid.cols * 827,
    grid.rows * 827,
  );

  // Step 2: Split the cropped image into 827x827 tiles
  const tileBuffers = await splitIntoTiles(croppedBuffer, grid.rows, grid.cols);

  // Step 3: Map to TileOutput with filenames
  return tileBuffers.map((buffer, index) => ({
    index,
    buffer,
    filename: `${job.jobId}_mosaicos_tile_${index}.png`,
  }));
}
