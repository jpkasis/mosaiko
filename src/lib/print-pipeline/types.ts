import type {
  CategoryCustomization,
  TonosCustomization,
} from '../customization-types';
import type { CropArea } from '../canvas-utils';

// ─── Print job input ────────────────────────────────────────────────────────

/**
 * Standard single-image print job. Used for every category except Tonos.
 */
export interface SingleImagePrintJob {
  /** Raw image buffer (PNG/JPEG) */
  imageBuffer: Buffer;
  /** Customization config (excludes tonos) */
  customization: Exclude<CategoryCustomization, TonosCustomization>;
  /** Crop area selected by the user */
  cropArea: CropArea;
  /** Unique order/job identifier for filename generation */
  jobId: string;
}

/**
 * Multi-image print job for Tonos. Holds 3 image buffers + 3 crop areas,
 * aligned positionally: buffer[i] goes with cropArea[i]. Optional rotations
 * are applied to each image before cropping (degrees, multiples of 90).
 */
export interface TonosPrintJob {
  imageBuffers: [Buffer, Buffer, Buffer];
  customization: TonosCustomization;
  cropAreas: [CropArea, CropArea, CropArea];
  rotations?: [number, number, number];
  jobId: string;
}

export type PrintJob = SingleImagePrintJob | TonosPrintJob;

// ─── Single tile output ─────────────────────────────────────────────────────

export interface TileOutput {
  /** Zero-based tile index (left-to-right, top-to-bottom) */
  index: number;
  /** Print-ready 827x827 PNG buffer */
  buffer: Buffer;
  /** Filename for storage, e.g. "job123_tile_0.png" */
  filename: string;
}

// ─── Processor result ───────────────────────────────────────────────────────

export interface ProcessorResult {
  /** All generated tiles for this print job */
  tiles: TileOutput[];
  /** Total number of tiles */
  tileCount: number;
  /** Category type that was processed */
  categoryType: CategoryCustomization['categoryType'];
  /** Job identifier */
  jobId: string;
}

// ─── Text rendering options (for SVG → Sharp text generation) ───────────────

export interface TextRenderOptions {
  text: string;
  width: number;
  height: number;
  fontSize: number;
  fontFamily?: string;
  color?: string;
  backgroundColor?: string;
  align?: 'left' | 'center' | 'right';
  verticalAlign?: 'top' | 'middle' | 'bottom';
  padding?: number;
}

// ─── Sharp filter config (for Tonos column filters) ─────────────────────────

export interface SharpFilterConfig {
  tileIndex: number;
  /** Hue rotation in degrees */
  hueRotation?: number;
  /** Saturation multiplier (1.0 = no change) */
  saturation?: number;
  /** Brightness multiplier (1.0 = no change) */
  brightness?: number;
  /** RGB tint to apply */
  tint?: { r: number; g: number; b: number };
  /** Whether to apply a slight blur (film grain effect) */
  blur?: number;
  /** Whether this tile keeps the original unfiltered image */
  isOriginal?: boolean;
}

// ─── CSS filter equivalent (for client-side preview) ────────────────────────

export interface CSSFilterPreset {
  tileIndex: number;
  filter: string;
  isOriginal?: boolean;
}
