import sharp from 'sharp';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { TILE_PRINT_SIZE } from '../../grid-config';
import type { SpotifyCustomization } from '../../customization-types';
import type { SingleImagePrintJob, TileOutput } from '../types';
import { CATEGORY_LAYOUTS } from '../../category-layouts';
import { derivePhotoRegion } from '../../category-layouts/derive';
import { cropAndResize, splitIntoTiles } from '../utils/tile-splitter';
import { renderTextLayer } from '../utils/text-renderer';

const TILE = TILE_PRINT_SIZE;

/**
 * Compute the combined visible photo region (across the 2×2 photo grid)
 * from the layout's per-tile bounds. Each tile is `sourceSize` px native;
 * combined is 2×sourceSize. Returns normalized 0..1 fractions so callers
 * can multiply by their own canvas size (2×TILE for the print composite).
 */
function combinedVisibleRegion() {
  const region = derivePhotoRegion(CATEGORY_LAYOUTS.spotify);
  if (!region) {
    throw new Error('[spotify] expected photo region in CATEGORY_LAYOUTS.spotify');
  }
  const s = region.sourceSize;
  const grid2 = 2 * s;
  // Each tile occupies a quadrant in the 2×2 grid. Map per-tile bounds
  // into combined-space coordinates (offset by tile's grid position).
  const tileOffset = (i: number) => ({
    dx: (i % 2) * s,
    dy: Math.floor(i / 2) * s,
  });
  let left = grid2, top = grid2, right = 0, bottom = 0;
  for (const idxStr of Object.keys(region.tiles)) {
    const i = Number(idxStr);
    const t = region.tiles[i];
    const off = tileOffset(i);
    left = Math.min(left, t.left + off.dx);
    top = Math.min(top, t.top + off.dy);
    right = Math.max(right, t.right + off.dx);
    bottom = Math.max(bottom, t.bottom + off.dy);
  }
  return {
    leftFrac: left / grid2,
    topFrac: top / grid2,
    rightFrac: right / grid2,
    bottomFrac: bottom / grid2,
  };
}

// Path to the template PNGs (relative to project root)
const TEMPLATE_DIR = join(process.cwd(), 'mosaic-categories/spotify/spotify-template-PNGs');
const LOGO_DIR = join(process.cwd(), 'mosaic-categories/spotify');
const MOSAIKO_LOGO_DIR = join(process.cwd(), 'MOSAIKO-logos');

/**
 * Spotify processor — uses actual PNG templates from the client.
 *
 * Grid is always 6 (3 rows x 2 cols):
 *   - Top 4 tiles (rows 0-1): 2x2 photo split + PNG frame overlay
 *   - Bottom 2 tiles (row 2): PNG background + text/logo composites
 */
export async function processSpotify(job: SingleImagePrintJob): Promise<TileOutput[]> {
  const customization = job.customization as SpotifyCustomization;
  const { songName, artistName } = customization;

  // Step 1: Crop the user's photo to the exact pixels of the visible
  // region (the transparent area inside the 2×2 template borders), then
  // place it on a transparent 2×TILE canvas at the offset and split into
  // 4 tiles. This ensures the user's chosen framing is what shows
  // through — the template's opaque rounded-card border doesn't crop
  // any part of their crop.
  const region = combinedVisibleRegion();
  const visibleW = Math.round((region.rightFrac - region.leftFrac) * 2 * TILE);
  const visibleH = Math.round((region.bottomFrac - region.topFrac) * 2 * TILE);
  const offX = Math.round(region.leftFrac * 2 * TILE);
  const offY = Math.round(region.topFrac * 2 * TILE);

  const visiblePhoto = await cropAndResize(
    job.imageBuffer,
    job.cropArea,
    visibleW,
    visibleH,
  );

  const canvasBuffer = await sharp({
    create: {
      width: 2 * TILE,
      height: 2 * TILE,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{ input: visiblePhoto, left: offX, top: offY }])
    .png()
    .toBuffer();

  const photoTiles = await splitIntoTiles(canvasBuffer, 2, 2);

  // Step 2: Overlay PNG template frames on each photo tile
  const framedPhotoTiles = await Promise.all(
    photoTiles.map(async (photoBuffer, index) => {
      const templatePath = join(TEMPLATE_DIR, `${index + 1}.png`);
      const templateBuffer = await readFile(templatePath);
      const resizedTemplate = await sharp(templateBuffer)
        .resize(TILE, TILE, { fit: 'fill' })
        .png()
        .toBuffer();

      return sharp(photoBuffer)
        .composite([{ input: resizedTemplate }])
        .png()
        .toBuffer();
    }),
  );

  // Step 3: Generate bottom-left tile (template bg + song/artist text + Spotify logo)
  const bottomLeftBuffer = await renderBottomLeftTile(songName, artistName);

  // Step 4: Generate bottom-right tile (template bg + Mosaiko logo)
  const bottomRightBuffer = await renderBottomRightTile();

  // Step 5: Assemble all tiles
  return [
    ...framedPhotoTiles.map((buffer, index) => ({
      index,
      buffer,
      filename: `${job.jobId}_spotify_tile_${index}.png`,
    })),
    {
      index: 4,
      buffer: bottomLeftBuffer,
      filename: `${job.jobId}_spotify_tile_4.png`,
    },
    {
      index: 5,
      buffer: bottomRightBuffer,
      filename: `${job.jobId}_spotify_tile_5.png`,
    },
  ];
}

/**
 * Bottom-left tile: template PNG background + song name + artist + Spotify logo.
 */
async function renderBottomLeftTile(
  songName: string,
  artistName: string,
): Promise<Buffer> {
  // Load and resize the template background
  const templateBuffer = await readFile(join(TEMPLATE_DIR, '5.png'));
  const baseBuffer = await sharp(templateBuffer)
    .resize(TILE, TILE, { fit: 'fill' })
    .png()
    .toBuffer();

  // Phase 4 — text rendered on canvas (was inline SVG / librsvg, which
  // dropped the Source Sans 3 font on Vercel and silently fell back to
  // DejaVu). Canvas's font registry (font-loader.ts) provides the actual
  // glyph outlines so the printed PNG matches the cropper preview.
  const textX = Math.round(TILE * 0.10);
  const songY = Math.round(TILE * 0.40);
  const artistY = Math.round(TILE * 0.55);
  const textBuffer = await renderTextLayer({
    width: TILE,
    height: TILE,
    texts: [
      {
        text: songName,
        x: textX,
        y: songY,
        fontFamily: 'Source Sans 3',
        fontSize: 56,
        fontWeight: 700,
        fill: '#FFFFFF',
        align: 'start',
      },
      {
        text: artistName,
        x: textX,
        y: artistY,
        fontFamily: 'Source Sans 3',
        fontSize: 40,
        fontWeight: 400,
        fill: '#FFFFFF',
        opacity: 0.7,
        align: 'start',
      },
    ],
  });

  // Load and resize Spotify logo
  const spotifyLogoBuffer = await readFile(join(LOGO_DIR, 'LOGO SPOTIFY.png'));
  const spotifyLogoResized = await sharp(spotifyLogoBuffer)
    .resize({ height: Math.round(TILE * 0.06) })
    .png()
    .toBuffer();
  const spotifyMeta = await sharp(spotifyLogoResized).metadata();

  // Composite everything onto the template base
  return sharp(baseBuffer)
    .composite([
      { input: textBuffer },
      {
        input: spotifyLogoResized,
        left: Math.round(TILE * 0.10),
        top: Math.round(TILE * 0.85),
      },
    ])
    .png()
    .toBuffer();
}

/**
 * Bottom-right tile: template PNG background + Mosaiko white logo.
 */
async function renderBottomRightTile(): Promise<Buffer> {
  // Load and resize the template background
  const templateBuffer = await readFile(join(TEMPLATE_DIR, '6.png'));
  const baseBuffer = await sharp(templateBuffer)
    .resize(TILE, TILE, { fit: 'fill' })
    .png()
    .toBuffer();

  // Load and resize Mosaiko white logo
  const mosaikoLogoBuffer = await readFile(join(MOSAIKO_LOGO_DIR, 'LOGO BLANCO.png'));
  const mosaikoLogoResized = await sharp(mosaikoLogoBuffer)
    .resize({ height: Math.round(TILE * 0.05) })
    .png()
    .toBuffer();
  const mosaikoMeta = await sharp(mosaikoLogoResized).metadata();

  // Position at bottom-right
  const logoLeft = TILE - Math.round(TILE * 0.08) - (mosaikoMeta.width || 100);
  const logoTop = Math.round(TILE * 0.88);

  return sharp(baseBuffer)
    .composite([
      {
        input: mosaikoLogoResized,
        left: logoLeft,
        top: logoTop,
      },
    ])
    .png()
    .toBuffer();
}
