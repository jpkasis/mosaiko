import { NextRequest, NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { uploadPrintTiles } from '@/lib/storage';
import type {
  CategoryCustomization,
  TonosCustomization,
} from '@/lib/customization-types';
import { CATEGORY_REGISTRY } from '@/lib/customization-types';
import type {
  ProcessorResult,
  PrintJob,
  SingleImagePrintJob,
  TonosPrintJob,
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
  photoUrl: string;
  customization: Exclude<CategoryCustomization, TonosCustomization>;
  cropArea: CropArea;
  orderId?: string;
}

interface TonosRequest {
  photoUrls: [string, string, string];
  customization: TonosCustomization;
  cropAreas: [CropArea, CropArea, CropArea];
  orderId?: string;
}

type GeneratePrintRequest = SingleImageRequest | TonosRequest;

// ─── Constants ──────────────────────────────────────────────────────────────

const MAX_IMAGE_SIZE = 20 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 15_000;

// ─── URL validation (SSRF prevention) ───────────────────────────────────────

const R2_PUBLIC_DOMAIN = process.env.R2_PUBLIC_URL
  ? new URL(process.env.R2_PUBLIC_URL).hostname
  : 'r2.mosaiko.mx';

const ALLOWED_PHOTO_HOSTS = new Set([
  R2_PUBLIC_DOMAIN,
  'cdn.shopify.com',
]);

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
    a.x >= 0 && a.y >= 0 && a.width > 0 && a.height > 0
  );
}

// ─── OrderId validation ─────────────────────────────────────────────────────

const ORDER_ID_PATTERN = /^[\w-]{1,128}$/;

function sanitizeOrderId(orderId?: string): string {
  if (!orderId) return crypto.randomUUID();
  if (!ORDER_ID_PATTERN.test(orderId)) {
    throw new Error('Invalid orderId format');
  }
  return orderId;
}

// ─── Fetch helper ───────────────────────────────────────────────────────────

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

// ─── POST /api/generate-print ───────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as GeneratePrintRequest;

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

    let orderId: string;
    try {
      orderId = sanitizeOrderId(body.orderId);
    } catch {
      return NextResponse.json(
        { error: 'Invalid orderId format. Use alphanumeric, hyphens, underscores (max 128 chars).' },
        { status: 400 },
      );
    }

    let job: PrintJob;

    if (body.customization.categoryType === 'tonos') {
      const tonosBody = body as TonosRequest;

      if (
        !Array.isArray(tonosBody.photoUrls) ||
        tonosBody.photoUrls.length !== 3 ||
        !tonosBody.photoUrls.every((u) => typeof u === 'string' && u.length > 0)
      ) {
        return NextResponse.json(
          { error: 'Tonos requires photoUrls to be an array of exactly 3 strings' },
          { status: 400 },
        );
      }

      if (
        !Array.isArray(tonosBody.cropAreas) ||
        tonosBody.cropAreas.length !== 3 ||
        !tonosBody.cropAreas.every(isValidCropArea)
      ) {
        return NextResponse.json(
          { error: 'Tonos requires cropAreas to be an array of exactly 3 valid crop areas' },
          { status: 400 },
        );
      }

      try {
        tonosBody.photoUrls.forEach(validatePhotoUrl);
      } catch (error) {
        return NextResponse.json(
          { error: error instanceof Error ? error.message : 'Invalid photo URL' },
          { status: 400 },
        );
      }

      let buffers: Buffer[];
      try {
        buffers = await Promise.all(tonosBody.photoUrls.map(fetchPhotoBuffer));
      } catch (error) {
        return NextResponse.json(
          { error: error instanceof Error ? error.message : 'Failed to fetch photo' },
          { status: 422 },
        );
      }

      const tonosJob: TonosPrintJob = {
        imageBuffers: [buffers[0], buffers[1], buffers[2]],
        customization: tonosBody.customization,
        cropAreas: [tonosBody.cropAreas[0], tonosBody.cropAreas[1], tonosBody.cropAreas[2]],
        jobId: orderId,
      };
      job = tonosJob;
    } else {
      const singleBody = body as SingleImageRequest;

      if (!singleBody.photoUrl) {
        return NextResponse.json(
          { error: 'Missing required field: photoUrl' },
          { status: 400 },
        );
      }

      if (!isValidCropArea(singleBody.cropArea)) {
        return NextResponse.json(
          { error: 'Missing or invalid required field: cropArea (x, y, width, height)' },
          { status: 400 },
        );
      }

      try {
        validatePhotoUrl(singleBody.photoUrl);
      } catch (error) {
        return NextResponse.json(
          { error: error instanceof Error ? error.message : 'Invalid photo URL' },
          { status: 400 },
        );
      }

      let imageBuffer: Buffer;
      try {
        imageBuffer = await fetchPhotoBuffer(singleBody.photoUrl);
      } catch (error) {
        return NextResponse.json(
          { error: error instanceof Error ? error.message : 'Failed to fetch photo' },
          { status: 422 },
        );
      }

      const singleJob: SingleImagePrintJob = {
        imageBuffer,
        customization: singleBody.customization,
        cropArea: singleBody.cropArea,
        jobId: orderId,
      };
      job = singleJob;
    }

    const { processPrintJob } = await import('@/lib/print-pipeline');
    const result: ProcessorResult = await processPrintJob(job);

    const storedTiles = await uploadPrintTiles(
      orderId,
      result.tiles.map((tile) => ({
        index: tile.index,
        buffer: tile.buffer,
      })),
    );

    const tiles = storedTiles.map((stored, i) => ({
      index: result.tiles[i].index,
      key: stored.key,
      url: stored.publicUrl,
    }));

    return NextResponse.json({
      orderId,
      categoryType: result.categoryType,
      tileCount: result.tileCount,
      tiles,
    });
  } catch (error) {
    console.error('[api/generate-print] Print generation failed:', error);

    if (error instanceof SyntaxError) {
      return NextResponse.json(
        { error: 'Invalid JSON in request body.' },
        { status: 400 },
      );
    }

    return NextResponse.json(
      { error: 'Print generation failed. Please try again.' },
      { status: 500 },
    );
  }
}
