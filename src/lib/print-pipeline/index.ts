import type {
  PrintJob,
  ProcessorResult,
  TileOutput,
  SingleImagePrintJob,
  TonosPrintJob,
} from './types';
import { processMosaicos } from './processors/mosaicos';
import { processSpotify } from './processors/spotify';
import { processTonos } from './processors/tonos';
import { processSaveTheDate } from './processors/save-the-date';
import { processArte } from './processors/arte';
import { processStudio } from './processors/studio';
import { processPolaroid } from './processors/polaroid';

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
