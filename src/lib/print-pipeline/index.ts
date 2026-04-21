import type {
  PrintJob,
  ProcessorResult,
  TileOutput,
  SingleImagePrintJob,
  TonosPrintJob,
} from './types';
import sharp from 'sharp';
import { processMosaicos } from './processors/mosaicos';
import { processSpotify } from './processors/spotify';
import { processTonos } from './processors/tonos';
import { processSaveTheDate } from './processors/save-the-date';
import { processArte } from './processors/arte';
import { processStudio } from './processors/studio';
import { processPolaroid } from './processors/polaroid';
import {
  assembleTilesToComposite,
  getCompositeLayout,
  CART_COMPOSITE_BG,
} from './utils/assemble-tiles';

// Re-export types for consumers
export type {
  PrintJob,
  SingleImagePrintJob,
  TonosPrintJob,
  ProcessorResult,
  TileOutput,
} from './types';
export type {
  TextRenderOptions,
  SharpFilterConfig,
  CSSFilterPreset,
} from './types';

// Re-export utilities
export { cropAndResize, splitIntoTiles } from './utils/tile-splitter';
export { renderTextToBuffer, renderMultiTextToBuffer } from './utils/text-renderer';
export {
  getTonosColumnFilter,
  getTonosColumnCSSFilter,
} from './utils/filter-presets';
export {
  assembleTilesToComposite,
  getCompositeLayout,
  CART_COMPOSITE_BG,
  type CompositeLayout,
  type TilePlacement,
} from './utils/assemble-tiles';

/**
 * Main print pipeline orchestrator.
 * Routes a PrintJob to the correct processor based on the
 * categoryType discriminant in the customization config.
 */
export async function processPrintJob(
  job: PrintJob,
): Promise<ProcessorResult> {
  const { customization, jobId } = job;

  let tiles: TileOutput[];

  switch (customization.categoryType) {
    case 'tonos':
      tiles = await processTonos(job as TonosPrintJob);
      break;
    case 'mosaicos':
      tiles = await processMosaicos(job as SingleImagePrintJob);
      break;
    case 'spotify':
      tiles = await processSpotify(job as SingleImagePrintJob);
      break;
    case 'save-the-date':
      tiles = await processSaveTheDate(job as SingleImagePrintJob);
      break;
    case 'arte':
      tiles = await processArte(job as SingleImagePrintJob);
      break;
    case 'studio':
      tiles = await processStudio(job as SingleImagePrintJob);
      break;
    case 'polaroid':
      tiles = await processPolaroid(job as SingleImagePrintJob);
      break;
    default: {
      const _exhaustive: never = customization;
      throw new Error(
        `Unknown category type: ${(_exhaustive as { categoryType: string }).categoryType}`,
      );
    }
  }

  return {
    tiles,
    tileCount: tiles.length,
    categoryType: customization.categoryType,
    jobId,
  };
}

// ─── Composite (preview) pipeline ──────────────────────────────────────────

export interface ComposedJob {
  /** Full-resolution assembled composite PNG (all tiles laid out gapless). */
  composite: Buffer;
  /** Pixel dimensions of the composite. */
  width: number;
  height: number;
  /** Downscaled cart thumbnail (JPEG for smaller files on the wire). */
  thumb: Buffer;
  /** Width of the thumb in pixels (height is proportional). */
  thumbWidth: number;
  /** Per-tile buffers (same list `processPrintJob` returns). */
  tiles: ProcessorResult['tiles'];
  categoryType: ProcessorResult['categoryType'];
  jobId: string;
}

/**
 * Runs the full print pipeline for a job AND assembles the resulting tiles
 * into one gapless composite PNG suitable for preview display, plus a
 * downscaled JPEG thumbnail. The composite uses the same per-category
 * layout as the DOM preview — for Arte that's a sparse 4×3 grid with tile
 * 8 at row 2, col 3; every other category is dense row-major.
 *
 * The tiles returned alongside the composite are identical to what
 * `processPrintJob(job)` would produce, so callers that want both (the
 * cart-composite endpoint saves the composite, a future order-time caller
 * can also persist the split tiles) do not need to run the processor
 * twice.
 */
export async function composePrintJob(
  job: PrintJob,
  options: { thumbWidth?: number } = {},
): Promise<ComposedJob> {
  const result = await processPrintJob(job);
  const layout = getCompositeLayout(job.customization);
  const composite = await assembleTilesToComposite(
    result.tiles,
    layout,
    CART_COMPOSITE_BG,
  );

  const thumbWidth = options.thumbWidth ?? 800;
  const thumb = await sharp(composite)
    .resize(thumbWidth)
    .jpeg({ quality: 85 })
    .toBuffer();

  return {
    composite,
    width: layout.width,
    height: layout.height,
    thumb,
    thumbWidth,
    tiles: result.tiles,
    categoryType: result.categoryType,
    jobId: result.jobId,
  };
}
