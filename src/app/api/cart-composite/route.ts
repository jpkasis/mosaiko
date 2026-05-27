import { NextRequest, NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { uploadBuffer } from '@/lib/storage';
import { put as putBlob } from '@/lib/cart-composite-blob-cache';
import type {
  CategoryCustomization,
  SaveTheDateCustomization,
  TonosCustomization,
} from '@/lib/customization-types';
import { CATEGORY_REGISTRY } from '@/lib/customization-types';
import { whitelistTonosFitModes } from '@/lib/shopify/webhook-parser';
import { PIPELINE_VERSION } from '@/lib/print-pipeline/version';
import type {
  PrintJob,
  SingleImagePrintJob,
  TonosPrintJob,
  SaveTheDateMultiPhotoPrintJob,
} from '@/lib/print-pipeline/types';

// ─── Server-side CropArea (mirrors client-side CropArea without DOM deps) ───

interface CropArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

// ─── Request body shape ─────────────────────────────────────────────────────

interface SingleImageRequest {
  /** Remote photo URL. Preferred when R2 is reachable. */
  photoUrl?: string;
  /** Inline base64 data URL for the photo. Fallback when R2 upload failed. */
  photoData?: string;
  customization: Exclude<CategoryCustomization, TonosCustomization>;
  cropArea: CropArea;
}

interface TonosRequest {
  photoUrls?: [string, string, string];
  photoDataUrls?: [string, string, string];
  customization: TonosCustomization;
  cropAreas: [CropArea, CropArea, CropArea];
  rotations?: [number, number, number];
}

/**
 * UAT-1b: STD-3 multi-photo request. Same shape as Tonos request
 * minus tonosSlots/intensity, plus a SaveTheDateCustomization with
 * gridSize: 3.
 */
interface SaveTheDateMultiPhotoRequest {
  photoUrls?: [string, string, string];
  photoDataUrls?: [string, string, string];
  customization: SaveTheDateCustomization & { gridSize: 3 };
  cropAreas: [CropArea, CropArea, CropArea];
}

type CartCompositeRequest =
  | SingleImageRequest
  | TonosRequest
  | SaveTheDateMultiPhotoRequest;

// ─── Constants ──────────────────────────────────────────────────────────────

const MAX_IMAGE_SIZE = 20 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 15_000;
// Allow up to 3 base64-encoded photos (~27 MB each after base64 overhead)
// plus JSON overhead. Hard cap to prevent unbounded body memory use.
const MAX_REQUEST_BODY_BYTES = 90 * 1024 * 1024;

// ─── URL validation (SSRF prevention) ───────────────────────────────────────

// Post-Shopify-Files migration: every photo lives on cdn.shopify.com.
const ALLOWED_PHOTO_HOSTS = new Set(['cdn.shopify.com']);

function validatePhotoUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('Invalid photo URL format');
  }
  if (parsed.protocol !== 'https:') {
    throw new Error('Only HTTPS photo URLs are allowed');
  }
  if (!ALLOWED_PHOTO_HOSTS.has(parsed.hostname)) {
    throw new Error(
      `Photo URL host not allowed: ${parsed.hostname}. ` +
        `Allowed: ${[...ALLOWED_PHOTO_HOSTS].join(', ')}`,
    );
  }
}

function isValidCropArea(c: unknown): c is CropArea {
  if (!c || typeof c !== 'object') return false;
  const a = c as Record<string, unknown>;
  return (
    typeof a.x === 'number' &&
    typeof a.y === 'number' &&
    typeof a.width === 'number' &&
    typeof a.height === 'number' &&
    a.x >= 0 &&
    a.y >= 0 &&
    a.width > 0 &&
    a.height > 0
  );
}

const DATA_URL_PREFIX = /^data:image\/[\w+.-]+;base64,/;

function decodePhotoDataUrl(dataUrl: string): Buffer {
  if (!DATA_URL_PREFIX.test(dataUrl)) {
    throw new Error('photoData must be a base64-encoded image data URL');
  }
  const base64 = dataUrl.replace(DATA_URL_PREFIX, '');
  const buffer = Buffer.from(base64, 'base64');
  if (buffer.length > MAX_IMAGE_SIZE) {
    throw new Error(`Photo too large (max ${MAX_IMAGE_SIZE / 1024 / 1024} MB)`);
  }
  return buffer;
}

async function fetchPhotoBuffer(url: string): Promise<Buffer> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    throw new Error(`Failed to fetch photo from URL: ${response.status}`);
  }

  const contentLength = response.headers.get('content-length');
  if (contentLength && parseInt(contentLength, 10) > MAX_IMAGE_SIZE) {
    throw new Error(`Photo too large (max ${MAX_IMAGE_SIZE / 1024 / 1024} MB)`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > MAX_IMAGE_SIZE) {
    throw new Error(`Photo too large (max ${MAX_IMAGE_SIZE / 1024 / 1024} MB)`);
  }
  return buffer;
}

// ─── POST /api/cart-composite ───────────────────────────────────────────────

/**
 * Generates the canonical composite image for a custom-magnet cart item:
 * runs the server print pipeline, assembles the resulting print tiles into
 * one gapless composite (per the category's layout), uploads a full-res
 * composite and a downscaled JPEG thumbnail to R2 under `cart-composites/`,
 * and returns both URLs. The thumbnail is what the cart renders.
 *
 * Cart, checkout, and print output all stem from the same Sharp pipeline,
 * so category-specific layouts (STD text, Spotify bar, Arte info tile,
 * Studio panels, Tonos filters, Polaroid frames) are preserved by
 * construction.
 */
export async function POST(request: NextRequest) {
  try {
    const contentLength = Number(request.headers.get('content-length') ?? 0);
    if (contentLength > 0 && contentLength > MAX_REQUEST_BODY_BYTES) {
      return NextResponse.json(
        { error: `Request body too large (max ${MAX_REQUEST_BODY_BYTES / 1024 / 1024} MB)` },
        { status: 413 },
      );
    }

    let body: CartCompositeRequest;
    try {
      body = (await request.json()) as CartCompositeRequest;
    } catch {
      return NextResponse.json(
        { error: 'Invalid JSON body' },
        { status: 400 },
      );
    }

    if (!body.customization || !body.customization.categoryType) {
      return NextResponse.json(
        { error: 'Missing required field: customization' },
        { status: 400 },
      );
    }

    if (!(body.customization.categoryType in CATEGORY_REGISTRY)) {
      return NextResponse.json(
        { error: `Unknown category type: ${body.customization.categoryType}` },
        { status: 400 },
      );
    }

    const jobId = `cart-${crypto.randomUUID()}`;

    let job: PrintJob;

    // UAT-1b: STD-3 multi-photo branch. Same input shape as Tonos
    // (3 photos + 3 cropAreas) but the resulting PrintJob is a
    // SaveTheDateMultiPhotoPrintJob — no tonosSlots / fitModes /
    // intensity. The STD processor branches on `imageBuffers` to
    // route into the multi-photo strip-assembly code path.
    if (
      body.customization.categoryType === 'save-the-date' &&
      (body.customization as SaveTheDateCustomization).gridSize === 3
    ) {
      const stdBody = body as SaveTheDateMultiPhotoRequest;

      if (
        !Array.isArray(stdBody.cropAreas) ||
        stdBody.cropAreas.length !== 3 ||
        !stdBody.cropAreas.every(isValidCropArea)
      ) {
        return NextResponse.json(
          { error: 'Save the Date 3-piece requires cropAreas to be an array of 3 valid crop areas' },
          { status: 400 },
        );
      }

      const photoUrls = stdBody.photoUrls;
      const photoDataUrls = stdBody.photoDataUrls;
      let buffers: Buffer[];

      if (Array.isArray(photoUrls) && photoUrls.length === 3 && photoUrls.every((u) => typeof u === 'string' && u.length > 0)) {
        try {
          photoUrls.forEach(validatePhotoUrl);
        } catch (error) {
          return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Invalid photo URL' },
            { status: 400 },
          );
        }
        try {
          buffers = await Promise.all(photoUrls.map(fetchPhotoBuffer));
        } catch (error) {
          return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Failed to fetch photo' },
            { status: 422 },
          );
        }
      } else if (
        Array.isArray(photoDataUrls) &&
        photoDataUrls.length === 3 &&
        photoDataUrls.every((u) => typeof u === 'string' && u.length > 0)
      ) {
        try {
          buffers = photoDataUrls.map(decodePhotoDataUrl);
        } catch (error) {
          return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Invalid photoData' },
            { status: 400 },
          );
        }
      } else {
        return NextResponse.json(
          { error: 'Save the Date 3-piece requires photoUrls or photoDataUrls (array of 3)' },
          { status: 400 },
        );
      }

      const stdJob: SaveTheDateMultiPhotoPrintJob = {
        imageBuffers: [buffers[0], buffers[1], buffers[2]],
        customization: stdBody.customization,
        cropAreas: [stdBody.cropAreas[0], stdBody.cropAreas[1], stdBody.cropAreas[2]],
        jobId,
      };
      job = stdJob;
    } else if (body.customization.categoryType === 'tonos') {
      const tonosBody = body as TonosRequest;

      if (
        !Array.isArray(tonosBody.cropAreas) ||
        tonosBody.cropAreas.length !== 3 ||
        !tonosBody.cropAreas.every(isValidCropArea)
      ) {
        return NextResponse.json(
          { error: 'Tonos requires cropAreas to be an array of 3 valid crop areas' },
          { status: 400 },
        );
      }

      const photoUrls = tonosBody.photoUrls;
      const photoDataUrls = tonosBody.photoDataUrls;
      let buffers: Buffer[];

      if (Array.isArray(photoUrls) && photoUrls.length === 3 && photoUrls.every((u) => typeof u === 'string' && u.length > 0)) {
        try {
          photoUrls.forEach(validatePhotoUrl);
        } catch (error) {
          return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Invalid photo URL' },
            { status: 400 },
          );
        }
        try {
          buffers = await Promise.all(photoUrls.map(fetchPhotoBuffer));
        } catch (error) {
          return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Failed to fetch photo' },
            { status: 422 },
          );
        }
      } else if (
        Array.isArray(photoDataUrls) &&
        photoDataUrls.length === 3 &&
        photoDataUrls.every((u) => typeof u === 'string' && u.length > 0)
      ) {
        try {
          buffers = photoDataUrls.map(decodePhotoDataUrl);
        } catch (error) {
          return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Invalid photoData' },
            { status: 400 },
          );
        }
      } else {
        return NextResponse.json(
          { error: 'Tonos requires photoUrls or photoDataUrls (array of 3)' },
          { status: 400 },
        );
      }

      let rotations: [number, number, number] | undefined;
      if (tonosBody.rotations !== undefined) {
        if (
          !Array.isArray(tonosBody.rotations) ||
          tonosBody.rotations.length !== 3 ||
          !tonosBody.rotations.every((r) => [0, 90, 180, 270].includes(r))
        ) {
          return NextResponse.json(
            { error: 'Tonos rotations must be an array of 3 values from {0, 90, 180, 270}' },
            { status: 400 },
          );
        }
        rotations = [tonosBody.rotations[0], tonosBody.rotations[1], tonosBody.rotations[2]];
      }

      // Forward per-slot fitMode through to the print job. Same
      // whitelist the order webhook uses — tonosSlots is treated as
      // untrusted user input (it came over the wire). See Phase 2 fix.
      const fitModes = whitelistTonosFitModes(
        (tonosBody.customization as unknown as { tonosSlots?: unknown }).tonosSlots,
      );

      const tonosJob: TonosPrintJob = {
        imageBuffers: [buffers[0], buffers[1], buffers[2]],
        customization: tonosBody.customization,
        cropAreas: [tonosBody.cropAreas[0], tonosBody.cropAreas[1], tonosBody.cropAreas[2]],
        rotations,
        fitModes,
        jobId,
      };
      job = tonosJob;
    } else {
      const singleBody = body as SingleImageRequest;

      if (!isValidCropArea(singleBody.cropArea)) {
        return NextResponse.json(
          { error: 'Missing or invalid required field: cropArea (x, y, width, height)' },
          { status: 400 },
        );
      }

      let imageBuffer: Buffer;
      if (singleBody.photoUrl) {
        try {
          validatePhotoUrl(singleBody.photoUrl);
        } catch (error) {
          return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Invalid photo URL' },
            { status: 400 },
          );
        }
        try {
          imageBuffer = await fetchPhotoBuffer(singleBody.photoUrl);
        } catch (error) {
          return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Failed to fetch photo' },
            { status: 422 },
          );
        }
      } else if (singleBody.photoData) {
        try {
          imageBuffer = decodePhotoDataUrl(singleBody.photoData);
        } catch (error) {
          return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Invalid photoData' },
            { status: 400 },
          );
        }
      } else {
        return NextResponse.json(
          { error: 'Missing required field: photoUrl or photoData' },
          { status: 400 },
        );
      }

      const singleJob: SingleImagePrintJob = {
        imageBuffer,
        customization: singleBody.customization,
        cropArea: singleBody.cropArea,
        jobId,
      };
      job = singleJob;
    }

    const { composePrintJob } = await import('@/lib/print-pipeline');
    const composed = await composePrintJob(job, { thumbWidth: 800 });

    // Try to upload full-res composite (PNG) and thumbnail (JPEG) to R2
    // under `cart-composites/`. Expectation: R2 has a lifecycle rule that
    // expires this prefix after ~30 days so abandoned carts self-clean;
    // paid orders copy the composite into `print-files/` before splitting.
    // If R2 is unreachable (e.g. local dev with placeholder creds), fall
    // back to stashing the composite + thumb in a per-process in-memory
    // cache and return URLs that resolve via /api/cart-composite/blob/[id].
    // The client must never receive data: URLs here — storing those on the
    // Zustand cart item overflows the browser's localStorage quota after a
    // handful of adds. The order flow regenerates from the original photo
    // at webhook time either way.
    const compositeKey = `cart-composites/${jobId}.png`;
    const thumbKey = `cart-composites/${jobId}_thumb.jpg`;

    try {
      const [compositeUpload, thumbUpload] = await Promise.all([
        uploadBuffer('print-files', compositeKey, composed.composite, 'image/png'),
        uploadBuffer('print-files', thumbKey, composed.thumb, 'image/jpeg'),
      ]);
      return NextResponse.json({
        jobId,
        categoryType: composed.categoryType,
        compositeKey: compositeUpload.key,
        compositeUrl: compositeUpload.publicUrl,
        thumbKey: thumbUpload.key,
        thumbUrl: thumbUpload.publicUrl,
        width: composed.width,
        height: composed.height,
        // Stamp the renderer version at composite creation time so the
        // webhook's bypass can reject stale composites (per Codex Phase 3
        // audit MAJOR). Cart item persists this; checkout forwards it.
        pipelineVersion: PIPELINE_VERSION,
      });
    } catch (uploadError) {
      if (process.env.NODE_ENV === 'production' && !process.env.ALLOW_BLOB_FALLBACK) {
        console.error(
          '[api/cart-composite] R2 upload failed in production:',
          uploadError instanceof Error ? uploadError.message : uploadError,
        );
        return NextResponse.json(
          { error: 'Storage unavailable' },
          { status: 503 },
        );
      }
      console.warn(
        '[api/cart-composite] R2 upload unavailable, using in-memory blob cache:',
        uploadError instanceof Error ? uploadError.message : uploadError,
      );
      const compositeBlobId = `${jobId}.png`;
      const thumbBlobId = `${jobId}_thumb.jpg`;
      putBlob(compositeBlobId, composed.composite, 'image/png');
      putBlob(thumbBlobId, composed.thumb, 'image/jpeg');
      return NextResponse.json({
        jobId,
        categoryType: composed.categoryType,
        compositeKey: null,
        compositeUrl: `/api/cart-composite/blob/${compositeBlobId}`,
        thumbKey: null,
        thumbUrl: `/api/cart-composite/blob/${thumbBlobId}`,
        width: composed.width,
        height: composed.height,
        pipelineVersion: PIPELINE_VERSION,
      });
    }
  } catch (error) {
    console.error('[api/cart-composite] Unhandled error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal error' },
      { status: 500 },
    );
  }
}
