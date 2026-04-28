import sharp from 'sharp';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { TILE_PRINT_SIZE } from '../../grid-config';
import type { SingleImagePrintJob, TileOutput } from '../types';
import { cropAndResize } from '../utils/tile-splitter';
import { polaroidLayout } from '../../category-layouts/polaroid';

const TILE = TILE_PRINT_SIZE;

const TEMPLATE_DIR = join(process.cwd(), 'mosaic-categories/polaroid/polaroid-template-PNGs');
const LOGO_DIR = join(process.cwd(), 'MOSAIKO-logos');

// Per-tile photo cutout bounds sourced from the shared category-layouts
// contract so the server processor and client preview derive from the same
// coordinate table. Values are expressed in the template PNGs' native pixel
// space and scaled to TILE_PRINT_SIZE at runtime.
const SRC_SIZE = polaroidLayout.frame!.photo.sourceSize;
const PHOTO_TILES = polaroidLayout.frame!.photo.tiles as Record<number, {
  left: number;
  top: number;
  right: number;
  bottom: number;
}>;
const PHOTO_AREAS = Array.from({ length: 4 }, (_, i) => PHOTO_TILES[i]);

/**
 * Polaroid processor — photo positioned within frame opening, frame PNG on top.
 *
 * Grid is always 4 (2x2). Each tile: photo sized to fit the transparent
 * area of the frame PNG, then frame composited on top.
 */
export async function processPolaroid(job: SingleImagePrintJob): Promise<TileOutput[]> {
  // Calculate the combined visible photo area across all 4 tiles
  // Top row visible height = SRC_SIZE - 64 (top frame) = 551px per tile
  // Bottom row visible height = 433px per tile (thick bottom frame)
  // Left col visible width = SRC_SIZE - 61 (left frame) = 554px per tile
  // Right col visible width = 554px per tile (right frame)
  const photoW = 554 + 554; // total visible width across 2 cols
  const photoH = 551 + 433; // total visible height across 2 rows

  // Crop user's photo to match the visible area aspect ratio
  const scale = TILE / SRC_SIZE;
  const printPhotoW = Math.round(photoW * scale);
  const printPhotoH = Math.round(photoH * scale);

  const croppedBuffer = await cropAndResize(
    job.imageBuffer,
    job.cropArea,
    printPhotoW,
    printPhotoH,
  );

  // Split the cropped photo into 4 portions matching each tile's visible area
  const tilePhotos = await Promise.all(
    PHOTO_AREAS.map(async (area, index) => {
      const areaW = area.right - area.left;
      const areaH = area.bottom - area.top;
      const printAreaW = Math.round(areaW * scale);
      const printAreaH = Math.round(areaH * scale);

      // Calculate extract position from the cropped photo
      const col = index % 2;
      const row = Math.floor(index / 2);
      const extractLeft = col === 0 ? 0 : Math.round(554 * scale);
      const extractTop = row === 0 ? 0 : Math.round(551 * scale);

      return sharp(croppedBuffer)
        .extract({
          left: extractLeft,
          top: extractTop,
          width: printAreaW,
          height: printAreaH,
        })
        .png()
        .toBuffer();
    }),
  );

  // Load, resize, and composite frame templates + position photos
  const framedTiles = await Promise.all(
    PHOTO_AREAS.map(async (area, index) => {
      // Create blank tile
      const blankTile = await sharp({
        create: { width: TILE, height: TILE, channels: 4, background: { r: 237, g: 237, b: 237, alpha: 255 } },
      }).png().toBuffer();

      // Position photo within the frame opening
      const photoLeft = Math.round(area.left * scale);
      const photoTop = Math.round(area.top * scale);

      // Load frame template
      const templateBuffer = await readFile(join(TEMPLATE_DIR, `${index + 1}.png`));
      const resizedTemplate = await sharp(templateBuffer)
        .resize(TILE, TILE, { fit: 'fill' })
        .png()
        .toBuffer();

      const composites: sharp.OverlayOptions[] = [
        { input: tilePhotos[index], left: photoLeft, top: photoTop },
        { input: resizedTemplate },
      ];

      // Add black Mosaiko logo on tile 4
      if (index === 3) {
        const logoBuffer = await readFile(join(LOGO_DIR, 'LOGO NEGRO.png'));
        const logoResized = await sharp(logoBuffer)
          .resize({ height: Math.round(TILE * 0.06) })
          .png()
          .toBuffer();
        const logoMeta = await sharp(logoResized).metadata();
        composites.push({
          input: logoResized,
          left: TILE - Math.round(TILE * 0.06) - (logoMeta.width || 80),
          top: Math.round(TILE * 0.90),
        });
      }

      return sharp(blankTile)
        .composite(composites)
        .png()
        .toBuffer();
    }),
  );

  return framedTiles.map((buffer, index) => ({
    index,
    buffer,
    filename: `${job.jobId}_polaroid_tile_${index}.png`,
  }));
}
