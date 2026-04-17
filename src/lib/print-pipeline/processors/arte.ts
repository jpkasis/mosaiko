import { TILE_PRINT_SIZE } from '../../grid-config';
import type { ArteCustomization } from '../../customization-types';
import type { SingleImagePrintJob, TileOutput } from '../types';
import { cropAndResize, splitIntoTiles } from '../utils/tile-splitter';
import { renderMultiTextToBuffer } from '../utils/text-renderer';

const TILE = TILE_PRINT_SIZE;

/**
 * Arte processor.
 * Layout is 4×2+1 (9 magnets total):
 *   - Tiles 0-7: photo split into 4 cols × 2 rows
 *   - Tile 8 (bottom-right): black info tile with title, artist, year
 */
export async function processArte(job: SingleImagePrintJob): Promise<TileOutput[]> {
  const customization = job.customization as ArteCustomization;
  const { title, artist, year } = customization;

  // Step 1: Crop image to 4×2 landscape and split into 8 photo tiles
  const croppedBuffer = await cropAndResize(
    job.imageBuffer,
    job.cropArea,
    4 * TILE,
    2 * TILE,
  );

  const allTiles = await splitIntoTiles(croppedBuffer, 2, 4);

  // Step 2: Generate the info tile (tile 8, bottom-right)
  const infoTileBuffer = await renderInfoTile(title, artist, year);

  // Step 3: Assemble — first 8 photo tiles + info tile
  const tiles: TileOutput[] = [];

  for (let i = 0; i < 8; i++) {
    tiles.push({
      index: i,
      buffer: allTiles[i],
      filename: `${job.jobId}_arte_tile_${i}.png`,
    });
  }

  tiles.push({
    index: 8,
    buffer: infoTileBuffer,
    filename: `${job.jobId}_arte_tile_8.png`,
  });

  return tiles;
}

/**
 * Renders the black info tile with title, artist name, and year.
 * Museum/gallery label aesthetic.
 */
async function renderInfoTile(
  title: string,
  artist: string,
  year: string,
): Promise<Buffer> {
  const centerX = TILE / 2;

  return renderMultiTextToBuffer(
    [
      {
        text: title,
        x: centerX,
        y: TILE / 2 - 80,
        fontSize: 52,
        fontFamily: 'serif',
        color: '#FFFFFF',
        anchor: 'middle',
      },
      {
        text: artist,
        x: centerX,
        y: TILE / 2 + 20,
        fontSize: 38,
        fontFamily: 'sans-serif',
        color: '#CCCCCC',
        anchor: 'middle',
      },
      {
        text: year,
        x: centerX,
        y: TILE / 2 + 100,
        fontSize: 32,
        fontFamily: 'sans-serif',
        color: '#999999',
        anchor: 'middle',
      },
    ],
    TILE,
    TILE,
    '#000000',
  );
}
