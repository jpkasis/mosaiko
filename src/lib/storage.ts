import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  CopyObjectCommand,
} from '@aws-sdk/client-s3';
import crypto from 'node:crypto';

// ─── Environment ─────────────────────────────────────────────────────────────

const R2_BUCKET_UPLOADS = process.env.R2_BUCKET_UPLOADS ?? 'mosaiko-uploads';
const R2_BUCKET_PRINT_FILES =
  process.env.R2_BUCKET_PRINT_FILES ?? 'mosaiko-print-files';
const R2_PUBLIC_URL =
  process.env.R2_PUBLIC_URL ?? 'https://r2.mosaiko.mx';

// ─── Environment validation ─────────────────────────────────────────────────

function getRequiredEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(
      `[R2 Storage] Missing required environment variable: ${key}. ` +
      'Ensure R2 credentials are configured in .env.local',
    );
  }
  return value;
}

// ─── S3 Client ──────────────────────────────────────────────────────────────

/** Shared R2 client -- created lazily and reused across invocations. */
let _client: S3Client | null = null;
function getClient(): S3Client {
  if (!_client) {
    const accountId = getRequiredEnv('R2_ACCOUNT_ID');
    const accessKeyId = getRequiredEnv('R2_ACCESS_KEY_ID');
    const secretAccessKey = getRequiredEnv('R2_SECRET_ACCESS_KEY');

    _client = new S3Client({
      region: 'auto',
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId, secretAccessKey },
    });
  }
  return _client;
}

// ─── Key sanitization ───────────────────────────────────────────────────────

const SAFE_KEY_SEGMENT = /^[\w.-]{1,256}$/;

function sanitizeKeySegment(segment: string, label: string): string {
  if (!SAFE_KEY_SEGMENT.test(segment)) {
    throw new Error(
      `[R2 Storage] Invalid ${label}: must be alphanumeric, hyphens, underscores, dots (max 256 chars)`,
    );
  }
  return segment;
}

// ─── Upload original photo ──────────────────────────────────────────────────

/**
 * Uploads a user's original photo to the public uploads bucket.
 *
 * @param file      Raw file data as a Buffer
 * @param extension File extension without dot (e.g. "jpg", "png", "webp")
 * @returns         The storage key and public URL for the uploaded file
 */
export async function uploadOriginalPhoto(
  file: Buffer,
  extension: string,
): Promise<{ key: string; publicUrl: string }> {
  const client = getClient();
  const uuid = crypto.randomUUID();
  const safeExt = sanitizeKeySegment(extension, 'file extension');
  const key = `originals/${uuid}.${safeExt}`;

  const contentTypeMap: Record<string, string> = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
  };

  await client.send(
    new PutObjectCommand({
      Bucket: R2_BUCKET_UPLOADS,
      Key: key,
      Body: file,
      ContentType: contentTypeMap[extension.toLowerCase()] ?? 'application/octet-stream',
    }),
  );

  return {
    key,
    publicUrl: getPublicUrl(key),
  };
}

// ─── Upload print tiles ─────────────────────────────────────────────────────

/**
 * Structured failure thrown by `uploadPrintTiles` when ONE OR MORE tile
 * PUTs fail. Carries both the tiles that successfully wrote (so the
 * caller can clean them up or know they're orphaned) and the tiles
 * that failed (so retries can target only the missing indexes).
 *
 * Before this type existed, `Promise.all` threw a plain Error on first
 * rejection while leaving already-resolved writes persisted in R2 with
 * no URL making it back to the metafield — the orphan bug.
 */
export class UploadFailure extends Error {
  readonly succeeded: { index: number; key: string; publicUrl: string }[];
  readonly failed: { index: number; reason: string }[];

  constructor(params: {
    succeeded: { index: number; key: string; publicUrl: string }[];
    failed: { index: number; reason: string }[];
  }) {
    super(
      `uploadPrintTiles: ${params.failed.length} of ${
        params.failed.length + params.succeeded.length
      } tiles failed`,
    );
    this.name = 'UploadFailure';
    this.succeeded = params.succeeded;
    this.failed = params.failed;
  }
}

/**
 * Uploads generated print tiles to the private print-files bucket.
 *
 * Partial failures throw an `UploadFailure` carrying which tiles
 * succeeded and which failed. Callers MUST NOT use the successful
 * URLs as a complete set — they are either fully committed together
 * or reported as a partial failure and left for a retry. See
 * `webhook-processor.ts` for the consumer contract.
 *
 * @param orderId Unique order/job identifier
 * @param tiles   Array of tile objects with index and buffer
 * @returns       Array of storage keys and URLs for each tile — only
 *                returned on FULL success. Any tile failure throws.
 */
export async function uploadPrintTiles(
  orderId: string,
  tiles: { index: number; buffer: Buffer }[],
): Promise<{ key: string; publicUrl: string }[]> {
  const client = getClient();
  const safeOrderId = sanitizeKeySegment(orderId, 'orderId');

  // Run uploads with `allSettled` so one failure doesn't hide the
  // outcome of the others. Then classify and either return clean or
  // throw a structured failure.
  const settled = await Promise.allSettled(
    tiles.map(async (tile) => {
      const key = `print-files/${safeOrderId}/tile-${tile.index}.png`;
      await client.send(
        new PutObjectCommand({
          Bucket: R2_BUCKET_PRINT_FILES,
          Key: key,
          Body: tile.buffer,
          ContentType: 'image/png',
        }),
      );
      return { index: tile.index, key, publicUrl: getPublicUrl(key) };
    }),
  );

  const succeeded: { index: number; key: string; publicUrl: string }[] = [];
  const failed: { index: number; reason: string }[] = [];

  settled.forEach((outcome, i) => {
    if (outcome.status === 'fulfilled') {
      succeeded.push(outcome.value);
    } else {
      const reason =
        outcome.reason instanceof Error
          ? outcome.reason.message
          : String(outcome.reason);
      failed.push({ index: tiles[i].index, reason });
    }
  });

  if (failed.length > 0) {
    throw new UploadFailure({ succeeded, failed });
  }

  return succeeded.map(({ key, publicUrl }) => ({ key, publicUrl }));
}

// ─── Get signed URL ─────────────────────────────────────────────────────────

/**
 * Generates a URL for accessing a private file.
 *
 * TODO: For production presigned URLs, install `@aws-sdk/s3-request-presigner`
 * and use its `getSignedUrl()` with `GetObjectCommand`. For now, this returns
 * the public URL pattern which works for the uploads bucket (public read).
 * For the print-files bucket (private), use the admin proxy endpoint instead:
 *   GET /api/admin/print-files?orderId=xxx
 *
 * @param key       The storage key of the file
 * @param _expiresIn Expiration in seconds (unused until presigner is added)
 */
export async function getSignedUrl(
  key: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  expiresIn: number = 3600,
): Promise<string> {
  // TODO: Replace with @aws-sdk/s3-request-presigner for true presigned URLs:
  //
  // import { getSignedUrl as awsGetSignedUrl } from '@aws-sdk/s3-request-presigner';
  // const command = new GetObjectCommand({ Bucket: R2_BUCKET_PRINT_FILES, Key: key });
  // return awsGetSignedUrl(getClient(), command, { expiresIn });
  //
  return getPublicUrl(key);
}

// ─── Get public URL ─────────────────────────────────────────────────────────

/**
 * Constructs the public URL for a file using the R2 custom domain.
 *
 * @param key The storage key of the file
 * @returns   Full public URL
 */
export function getPublicUrl(key: string): string {
  // Strip leading slash if present to avoid double slashes
  const cleanKey = key.startsWith('/') ? key.slice(1) : key;
  return `${R2_PUBLIC_URL}/${cleanKey}`;
}

// ─── Get object stream (for admin proxy downloads) ──────────────────────────

/**
 * Retrieves a file from the print-files bucket as a readable stream.
 * Used by the admin print-files endpoint to proxy private downloads.
 *
 * @param key The storage key of the file
 * @returns   The S3 GetObjectCommand output (body is a ReadableStream)
 */
export async function getObject(bucket: 'uploads' | 'print-files', key: string) {
  const client = getClient();
  const bucketName =
    bucket === 'uploads' ? R2_BUCKET_UPLOADS : R2_BUCKET_PRINT_FILES;

  return client.send(
    new GetObjectCommand({
      Bucket: bucketName,
      Key: key,
    }),
  );
}

// ─── List files by prefix ───────────────────────────────────────────────────

/**
 * Lists all objects in a bucket matching a given prefix.
 * Useful for finding all print tiles for an order.
 *
 * @param bucket The bucket to search
 * @param prefix Key prefix to filter by (e.g. "print-files/order123/")
 * @returns      Array of object keys matching the prefix
 */
export async function listFiles(
  bucket: 'uploads' | 'print-files',
  prefix: string,
): Promise<string[]> {
  const client = getClient();
  const bucketName =
    bucket === 'uploads' ? R2_BUCKET_UPLOADS : R2_BUCKET_PRINT_FILES;

  // ListObjectsV2 returns at most 1000 keys per page. Continuation
  // tokens drive subsequent pages — without this loop, callers operating
  // on buckets with >1000 keys would silently see only the first page.
  const all: string[] = [];
  let continuationToken: string | undefined;
  do {
    const response = await client.send(
      new ListObjectsV2Command({
        Bucket: bucketName,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      }),
    );
    for (const obj of response.Contents ?? []) {
      if (obj.Key) all.push(obj.Key);
    }
    continuationToken = response.IsTruncated
      ? response.NextContinuationToken
      : undefined;
  } while (continuationToken);
  return all;
}

// ─── Delete file ────────────────────────────────────────────────────────────

/**
 * Deletes a file from the specified bucket.
 *
 * @param bucket Which bucket to delete from
 * @param key    The storage key of the file to delete
 */
export async function deleteFile(
  bucket: 'uploads' | 'print-files',
  key: string,
): Promise<void> {
  const client = getClient();
  const bucketName =
    bucket === 'uploads' ? R2_BUCKET_UPLOADS : R2_BUCKET_PRINT_FILES;

  await client.send(
    new DeleteObjectCommand({
      Bucket: bucketName,
      Key: key,
    }),
  );
}

// ─── JSON helpers ────────────────────────────────────────────────────────────

export async function putJsonObject<T>(
  bucket: 'uploads' | 'print-files',
  key: string,
  data: T,
): Promise<void> {
  const client = getClient();
  const bucketName =
    bucket === 'uploads' ? R2_BUCKET_UPLOADS : R2_BUCKET_PRINT_FILES;

  await client.send(
    new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      Body: JSON.stringify(data),
      ContentType: 'application/json',
    }),
  );
}

export async function getJsonObject<T>(
  bucket: 'uploads' | 'print-files',
  key: string,
): Promise<T | null> {
  const client = getClient();
  const bucketName =
    bucket === 'uploads' ? R2_BUCKET_UPLOADS : R2_BUCKET_PRINT_FILES;

  try {
    const response = await client.send(
      new GetObjectCommand({
        Bucket: bucketName,
        Key: key,
      }),
    );
    const body = await response.Body?.transformToString();
    if (!body) return null;
    return JSON.parse(body) as T;
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'name' in err && err.name === 'NoSuchKey') {
      return null;
    }
    throw err;
  }
}

// ─── Upload raw buffer ──────────────────────────────────────────────────────

export async function uploadBuffer(
  bucket: 'uploads' | 'print-files',
  key: string,
  buffer: Buffer,
  contentType: string,
): Promise<{ key: string; publicUrl: string }> {
  const client = getClient();
  const bucketName =
    bucket === 'uploads' ? R2_BUCKET_UPLOADS : R2_BUCKET_PRINT_FILES;

  await client.send(
    new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      Body: buffer,
      ContentType: contentType,
    }),
  );

  return { key, publicUrl: getPublicUrl(key) };
}

// ─── Copy object ────────────────────────────────────────────────────────────

export async function copyObject(
  bucket: 'uploads' | 'print-files',
  sourceKey: string,
  destKey: string,
): Promise<void> {
  const client = getClient();
  const bucketName =
    bucket === 'uploads' ? R2_BUCKET_UPLOADS : R2_BUCKET_PRINT_FILES;

  await client.send(
    new CopyObjectCommand({
      Bucket: bucketName,
      CopySource: `${bucketName}/${sourceKey}`,
      Key: destKey,
    }),
  );
}
