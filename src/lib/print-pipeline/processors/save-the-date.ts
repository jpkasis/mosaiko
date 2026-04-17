import sharp from 'sharp';
import { GRID_CONFIGS, TILE_PRINT_SIZE } from '../../grid-config';
import type { SaveTheDateCustomization } from '../../customization-types';
import type { SingleImagePrintJob, TileOutput } from '../types';
import { cropAndResize, splitIntoTiles } from '../utils/tile-splitter';

const TILE = TILE_PRINT_SIZE;

/**
 * Save the Date processor.
 *
 * All tiles are the photo split normally. Specific tiles receive a light
 * semi-transparent white wash with elegant white text + drop shadow,
 * matching the romantic/wedding aesthetic of the reference designs.
 *
 * Tile placement per grid:
 *  - 9-piece (3x3): tile 0 = "Save", tile 1 = "The" + date, tile 2 = "Date"
 *  - 6-piece (3x2): tile 0 = "Save The Date", tile 1 = date
 *  - 3-piece (1x3): tile 2 = date only
 */
export async function processSaveTheDate(
  job: SingleImagePrintJob,
): Promise<TileOutput[]> {
  const customization = job.customization as SaveTheDateCustomization;
  const grid = GRID_CONFIGS[customization.gridSize];

  // Step 1: Crop and split the full image
  const croppedBuffer = await cropAndResize(
    job.imageBuffer,
    job.cropArea,
    grid.cols * TILE,
    grid.rows * TILE,
  );

  const tileBuffers = await splitIntoTiles(croppedBuffer, grid.rows, grid.cols);

  // Step 2: Determine which tiles get text overlays
  const textTileConfigs = getTextTileConfigs(
    customization.gridSize,
    customization.eventText,
    customization.date,
  );

  // Step 3: Build a map of tile index -> overlay configs
  const overlaysByTile = new Map<number, TextTileConfig[]>();
  for (const config of textTileConfigs) {
    const existing = overlaysByTile.get(config.index) ?? [];
    existing.push(config);
    overlaysByTile.set(config.index, existing);
  }

  // Step 4: Apply text overlays to the designated tiles
  const processedTiles = await Promise.all(
    tileBuffers.map(async (buffer, index) => {
      const overlays = overlaysByTile.get(index);
      if (!overlays) return buffer;

      // Apply each overlay sequentially to this tile
      let result = buffer;
      for (const config of overlays) {
        result = await applyTextOverlay(result, config);
      }
      return result;
    }),
  );

  return processedTiles.map((buffer, index) => ({
    index,
    buffer,
    filename: `${job.jobId}_save-the-date_tile_${index}.png`,
  }));
}

interface TextTileConfig {
  index: number;
  /** Lines of text to render, each with its own style */
  lines: TextLine[];
}

interface TextLine {
  text: string;
  fontSize: number;
  fontStyle: 'italic' | 'normal';
  /** Vertical center offset from tile center (negative = above, positive = below) */
  yOffset: number;
}

/**
 * Returns tile overlay configurations based on grid size.
 *
 *  9-piece (3x3 top row):
 *    tile 0: "Save" in script
 *    tile 1: "The" in script + date below
 *    tile 2: "Date" in script
 *
 *  6-piece (3x2 top row):
 *    tile 0: "Save The Date" in script
 *    tile 1: date in serif
 *
 *  3-piece (1x3):
 *    tile 2: date in serif
 */
function getTextTileConfigs(
  gridSize: 3 | 6 | 9,
  _eventText: string,
  date: string,
): TextTileConfig[] {
  switch (gridSize) {
    case 9:
      return [
        {
          index: 0,
          lines: [
            { text: 'Save', fontSize: 100, fontStyle: 'italic', yOffset: 0 },
          ],
        },
        {
          index: 1,
          lines: [
            { text: 'The', fontSize: 100, fontStyle: 'italic', yOffset: -50 },
            { text: date, fontSize: 52, fontStyle: 'normal', yOffset: 70 },
          ],
        },
        {
          index: 2,
          lines: [
            { text: 'Date', fontSize: 100, fontStyle: 'italic', yOffset: 0 },
          ],
        },
      ];

    case 6:
      return [
        {
          index: 0,
          lines: [
            { text: 'Save The Date', fontSize: 72, fontStyle: 'italic', yOffset: 0 },
          ],
        },
        {
          index: 1,
          lines: [
            { text: date, fontSize: 56, fontStyle: 'normal', yOffset: 0 },
          ],
        },
      ];

    case 3:
      return [
        {
          index: 2,
          lines: [
            { text: date, fontSize: 56, fontStyle: 'normal', yOffset: 0 },
          ],
        },
      ];

    default:
      return [];
  }
}

/**
 * Composites a light semi-transparent wash with elegant white text
 * onto a tile. Uses white text (#FFFFFF) with a dark drop shadow
 * over a subtle rgba(255,255,255,0.2) full-tile wash.
 */
async function applyTextOverlay(
  tileBuffer: Buffer,
  config: TextTileConfig,
): Promise<Buffer> {
  const centerY = TILE / 2;

  const textElements = config.lines
    .map((line) => {
      const escapedText = line.text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');

      const y = centerY + line.yOffset;
      const style = line.fontStyle === 'italic' ? 'italic' : 'normal';

      return `<text
        x="${TILE / 2}" y="${y}"
        font-family="Georgia, 'Times New Roman', serif"
        font-size="${line.fontSize}"
        font-style="${style}"
        font-weight="${line.fontStyle === 'italic' ? '400' : '400'}"
        fill="#FFFFFF"
        text-anchor="middle"
        dominant-baseline="central"
        letter-spacing="${line.fontStyle === 'italic' ? '0.04em' : '0.12em'}"
      >${escapedText}</text>`;
    })
    .join('\n');

  // Drop shadow filter for text readability over photos
  const overlaySvg = `<svg width="${TILE}" height="${TILE}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <filter id="textShadow" x="-10%" y="-10%" width="120%" height="120%">
        <feDropShadow dx="0" dy="2" stdDeviation="4" flood-color="rgba(0,0,0,0.5)" />
      </filter>
    </defs>

    <!-- Light semi-transparent wash over entire tile -->
    <rect x="0" y="0" width="${TILE}" height="${TILE}" fill="rgba(255,255,255,0.2)" />

    <!-- Text with drop shadow -->
    <g filter="url(#textShadow)">
      ${textElements}
    </g>
  </svg>`;

  const overlayBuffer = await sharp(Buffer.from(overlaySvg))
    .resize(TILE, TILE)
    .png()
    .toBuffer();

  return sharp(tileBuffer)
    .composite([{ input: overlayBuffer, blend: 'over' }])
    .png()
    .toBuffer();
}
