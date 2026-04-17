import sharp from 'sharp';
import { TILE_PRINT_SIZE } from '../../grid-config';
import { getTileLayout } from '../../customization-types';
import type { TonosPrintJob, TileOutput, SharpFilterConfig } from '../types';
import { cropAndResize } from '../utils/tile-splitter';
import { getTonosColumnFilter } from '../utils/filter-presets';

/**
 * Tonos processor.
 *
 * Takes 3 uploaded images and 3 crop areas. Each tile shows one complete
 * picture (picked per tile descriptor). Columns impose fixed tone treatments:
 *   left = warm, middle = none (original), right = cool.
 * User-selected intensity scales the warm/cool effect.
 *
 * 9-grid: row i → picture i; 3 columns per row → 3 tone variants.
 * 3-grid: one picture per tile in columns warm/none/cool.
 */
export async function processTonos(job: TonosPrintJob): Promise<TileOutput[]> {
  const { customization, imageBuffers, cropAreas, rotations } = job;
  const tileDescriptors = getTileLayout(customization);

  // Apply rotation per image (if any), then crop each source to TILE_PRINT_SIZE.
  const croppedPerSource = await Promise.all(
    imageBuffers.map(async (buf, i) => {
      const deg = rotations?.[i] ?? 0;
      const source = deg === 0
        ? buf
        : await sharp(buf).rotate(deg).png().toBuffer();
      return cropAndResize(source, cropAreas[i], TILE_PRINT_SIZE, TILE_PRINT_SIZE);
    }),
  );

  const tiles = await Promise.all(
    tileDescriptors.map(async (td): Promise<TileOutput> => {
      const sourceIdx = td.sourceImageIndex ?? 0;
      const column = td.toneColumn ?? 'none';
      const baseBuffer = croppedPerSource[sourceIdx];

      const filter = getTonosColumnFilter(column, customization.intensity, td.index);
      const buffer = filter.isOriginal
        ? baseBuffer
        : await applySharpFilter(baseBuffer, filter);

      return {
        index: td.index,
        buffer,
        filename: `${job.jobId}_tonos_${customization.intensity}_${column}_tile_${td.index}.png`,
      };
    }),
  );

  return tiles;
}

async function applySharpFilter(
  buffer: Buffer,
  config: SharpFilterConfig,
): Promise<Buffer> {
  let pipeline = sharp(buffer);

  if (
    config.hueRotation !== undefined ||
    config.saturation !== undefined ||
    config.brightness !== undefined
  ) {
    pipeline = pipeline.modulate({
      ...(config.hueRotation !== undefined && { hue: config.hueRotation }),
      ...(config.saturation !== undefined && { saturation: config.saturation }),
      ...(config.brightness !== undefined && { brightness: config.brightness }),
    });
  }

  if (config.tint) pipeline = pipeline.tint(config.tint);
  if (config.blur && config.blur > 0) pipeline = pipeline.blur(config.blur);

  return pipeline.png().toBuffer();
}
