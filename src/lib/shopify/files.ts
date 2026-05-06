/**
 * Shopify Files API primitives — batch-aware.
 *
 * Three-step happy path (and the only documented one):
 *   1. `stagedUploadsCreate(input: [...N])` returns N pre-signed
 *      Google Cloud Storage POST targets.
 *   2. POST each file's bytes (in parallel) to its target as
 *      `multipart/form-data`. All `parameters` returned by Shopify must
 *      be appended BEFORE the `file` field, in order — GCS validates the
 *      policy against the exact field set.
 *   3. `fileCreate(files: [...N])` registers the files in the store.
 *      `fileStatus` is asynchronous: UPLOADED → PROCESSING → READY (or
 *      FAILED). `image.url` (the cdn.shopify.com URL) is only populated
 *      when READY, so callers MUST poll `nodes(ids: [...])` until every
 *      file is READY before recording any URL.
 *
 * Constraints:
 *   - 20 MB hard cap per file. We pre-resize to ≤ 15 MB to stay well
 *     under after Shopify metadata overhead.
 *   - 20 MP hard cap per image. We pre-resize to ≤ 16 MP.
 *   - `fileCreate` accepts up to 250 files per call.
 *   - Filename collisions: by default Shopify appends a UUID
 *     (`APPEND_UUID`), which kills any deterministic filename → URL
 *     mapping. We use `duplicateResolutionMode: REPLACE` for retry-prone
 *     paths (print tiles) so the same filename overwrites in place.
 *   - `READY_TIMEOUT_MS` is configurable via env so production can tune
 *     for actual tile sizes; default is 30 s (smoke-test 1×1 PNG hit
 *     READY in 2.5 s; real ~1-3 MB PNGs may take longer on a cold CDN).
 */

import { shopifyAdminFetch, getAdminAccessToken, SHOPIFY_API_VERSION } from './client';

// Sharp is loaded lazily so the static import graph of this module stays
// client-safe (catalog-data.ts dynamically imports product-store →
// storage → here, and Next 16's Turbopack will trace static imports
// into the client bundle even when the call site is unreachable from
// client code). See `next.config.ts#serverExternalPackages`.
async function getSharp() {
  const mod = await import('sharp');
  return mod.default;
}

// ─── Limits ─────────────────────────────────────────────────────────────────

export const SHOPIFY_FILE_MAX_BYTES = 15 * 1024 * 1024;
export const SHOPIFY_IMAGE_MAX_PIXELS = 16 * 1_000_000;

const READY_TIMEOUT_MS = Number(
  process.env.SHOPIFY_FILE_READY_TIMEOUT_MS ?? 30_000,
);
const READY_POLL_INITIAL_MS = 500;
const READY_POLL_MAX_MS = 2_000;

// ─── Pre-resize helper ──────────────────────────────────────────────────────

/**
 * Resizes a buffer to satisfy Shopify's caps. Returns the original buffer
 * untouched if it's already within both caps (the common case for our
 * print-tile output).
 */
export async function resizeForShopifyFiles(
  buffer: Buffer,
  contentType: string,
): Promise<Buffer> {
  const isImage = contentType.startsWith('image/');
  if (!isImage) {
    if (buffer.byteLength <= SHOPIFY_FILE_MAX_BYTES) return buffer;
    throw new Error(
      `[shopify-files] Non-image payload ${buffer.byteLength}B exceeds ${SHOPIFY_FILE_MAX_BYTES}B`,
    );
  }

  const sharp = await getSharp();
  let img = sharp(buffer, { failOn: 'error' });
  const meta = await img.metadata();
  const w = meta.width ?? 0;
  const h = meta.height ?? 0;
  const pixels = w * h;

  let needsRescale = false;
  if (pixels > SHOPIFY_IMAGE_MAX_PIXELS && w > 0 && h > 0) {
    const scale = Math.sqrt(SHOPIFY_IMAGE_MAX_PIXELS / pixels);
    img = img.resize(Math.floor(w * scale), Math.floor(h * scale), {
      fit: 'inside',
      withoutEnlargement: true,
    });
    needsRescale = true;
  }

  if (!needsRescale && buffer.byteLength <= SHOPIFY_FILE_MAX_BYTES) {
    return buffer;
  }

  const out =
    contentType === 'image/jpeg' || contentType === 'image/jpg'
      ? await img.jpeg({ quality: 90 }).toBuffer()
      : contentType === 'image/webp'
      ? await img.webp({ quality: 90 }).toBuffer()
      : await img.png({ compressionLevel: 9 }).toBuffer();

  if (out.byteLength > SHOPIFY_FILE_MAX_BYTES) {
    let factor = 0.85;
    let attempt = sharp(out);
    while (factor > 0.3) {
      const m = await attempt.metadata();
      const nw = Math.floor((m.width ?? 1) * factor);
      const nh = Math.floor((m.height ?? 1) * factor);
      attempt = sharp(out).resize(nw, nh, { fit: 'inside' });
      // (sharp is the same dynamic import resolved above)
      const next =
        contentType === 'image/jpeg' || contentType === 'image/jpg'
          ? await attempt.jpeg({ quality: 85 }).toBuffer()
          : contentType === 'image/webp'
          ? await attempt.webp({ quality: 85 }).toBuffer()
          : await attempt.png({ compressionLevel: 9 }).toBuffer();
      if (next.byteLength <= SHOPIFY_FILE_MAX_BYTES) return next;
      factor *= 0.85;
    }
    throw new Error(
      `[shopify-files] Could not shrink image under ${SHOPIFY_FILE_MAX_BYTES}B even after iterative downscale`,
    );
  }
  return out;
}

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ShopifyUploadResult {
  /** The Shopify file GID, e.g. `gid://shopify/MediaImage/123` */
  id: string;
  /** The cdn.shopify.com URL — the only stable handle to the bytes. */
  url: string;
  /** The filename the caller supplied (NOT a Shopify-deduped form, since
   *  we use REPLACE duplicate-resolution). Useful for binding/debug. */
  filename: string;
}

export interface UploadInput {
  filename: string;
  /** MIME type for the payload, e.g. `image/png`, `application/json`. */
  mimeType: string;
  buffer: Buffer;
  alt?: string;
  /** REPLACE = retry-friendly (overwrites in place). APPEND_UUID = the
   *  Shopify default but produces unpredictable filenames; we never use
   *  it for our managed filenames. RAISE_ERROR is for paranoid dedup. */
  duplicateResolutionMode?: 'REPLACE' | 'APPEND_UUID' | 'RAISE_ERROR';
}

interface StagedTarget {
  url: string;
  resourceUrl: string;
  parameters: Array<{ name: string; value: string }>;
}

interface FileNode {
  id: string;
  fileStatus: 'UPLOADED' | 'PROCESSING' | 'READY' | 'FAILED';
  alt: string | null;
  image?: { url: string } | null;
  preview?: { image?: { url: string } | null } | null;
  url?: string;
}

// ─── Stage ──────────────────────────────────────────────────────────────────

async function stageFiles(
  inputs: { filename: string; mimeType: string; fileSize: string }[],
): Promise<StagedTarget[]> {
  const data = await shopifyAdminFetch<{
    stagedUploadsCreate: {
      stagedTargets: StagedTarget[];
      userErrors: Array<{ field: string[]; message: string }>;
    };
  }>({
    query: `
      mutation StagedUploadsCreate($input: [StagedUploadInput!]!) {
        stagedUploadsCreate(input: $input) {
          stagedTargets {
            url
            resourceUrl
            parameters { name value }
          }
          userErrors { field message }
        }
      }
    `,
    variables: {
      input: inputs.map((i) => ({
        ...i,
        resource: 'FILE',
        httpMethod: 'POST',
      })),
    },
  });
  if (data.stagedUploadsCreate.userErrors.length > 0) {
    throw new Error(
      `[shopify-files] stagedUploadsCreate userErrors: ${JSON.stringify(
        data.stagedUploadsCreate.userErrors,
      )}`,
    );
  }
  if (data.stagedUploadsCreate.stagedTargets.length !== inputs.length) {
    throw new Error(
      `[shopify-files] stagedUploadsCreate returned ${data.stagedUploadsCreate.stagedTargets.length} targets for ${inputs.length} inputs`,
    );
  }
  return data.stagedUploadsCreate.stagedTargets;
}

async function postBytesToStagedTarget(
  target: StagedTarget,
  filename: string,
  mimeType: string,
  buffer: Buffer,
): Promise<void> {
  const form = new FormData();
  for (const p of target.parameters) form.append(p.name, p.value);
  form.append(
    'file',
    new Blob([buffer as unknown as BlobPart], { type: mimeType }),
    filename,
  );
  const res = await fetch(target.url, { method: 'POST', body: form });
  if (!res.ok) {
    throw new Error(
      `[shopify-files] Staged POST HTTP ${res.status}: ${await res.text()}`,
    );
  }
}

// ─── fileCreate ─────────────────────────────────────────────────────────────

interface FileCreateBatchInput {
  originalSource: string;
  contentType: 'IMAGE' | 'FILE';
  alt?: string;
  filename: string;
  duplicateResolutionMode?: 'REPLACE' | 'APPEND_UUID' | 'RAISE_ERROR';
}

async function fileCreateBatch(
  inputs: FileCreateBatchInput[],
): Promise<string[]> {
  const data = await shopifyAdminFetch<{
    fileCreate: {
      files: Array<{ id: string; fileStatus: string }>;
      userErrors: Array<{ field: string[]; message: string }>;
    };
  }>({
    query: `
      mutation FileCreate($files: [FileCreateInput!]!) {
        fileCreate(files: $files) {
          files { id fileStatus }
          userErrors { field message }
        }
      }
    `,
    variables: { files: inputs },
  });
  // Codex audit (medium): Shopify can return PARTIAL `files` alongside
  // `userErrors` — every ID that did materialise is now an orphan
  // unless we delete before throwing. Same for the count-mismatch
  // safety check.
  const createdIds = data.fileCreate.files.map((f) => f.id).filter(Boolean);
  if (data.fileCreate.userErrors.length > 0) {
    if (createdIds.length > 0) await bestEffortDelete(createdIds);
    throw new Error(
      `[shopify-files] fileCreate userErrors: ${JSON.stringify(
        data.fileCreate.userErrors,
      )}`,
    );
  }
  if (createdIds.length !== inputs.length) {
    if (createdIds.length > 0) await bestEffortDelete(createdIds);
    throw new Error(
      `[shopify-files] fileCreate returned ${createdIds.length} files for ${inputs.length} inputs`,
    );
  }
  return createdIds;
}

// ─── Polling ────────────────────────────────────────────────────────────────

async function pollNodes(ids: string[]): Promise<FileNode[]> {
  if (ids.length === 0) return [];
  const data = await shopifyAdminFetch<{ nodes: Array<FileNode | null> }>({
    query: `
      query Nodes($ids: [ID!]!) {
        nodes(ids: $ids) {
          ... on MediaImage {
            id
            fileStatus
            alt
            image { url }
            preview { image { url } }
          }
          ... on GenericFile {
            id
            fileStatus
            alt
            url
          }
        }
      }
    `,
    variables: { ids },
  });
  return data.nodes.map((n, i) => {
    if (!n) {
      throw new Error(`[shopify-files] node ${ids[i]} not found in poll`);
    }
    return n;
  });
}

function urlOfNode(node: FileNode): string | null {
  return (
    node.image?.url ?? node.preview?.image?.url ?? node.url ?? null
  );
}

async function waitUntilAllReady(
  ids: string[],
): Promise<Map<string, string>> {
  const start = Date.now();
  let delay = READY_POLL_INITIAL_MS;
  const ready = new Map<string, string>();
  let pending = [...ids];

  while (pending.length > 0 && Date.now() - start < READY_TIMEOUT_MS) {
    const nodes = await pollNodes(pending);
    const stillPending: string[] = [];
    for (const node of nodes) {
      if (node.fileStatus === 'READY') {
        const url = urlOfNode(node);
        if (!url) {
          throw new Error(
            `[shopify-files] ${node.id} READY but no url in response: ${JSON.stringify(node)}`,
          );
        }
        ready.set(node.id, url);
      } else if (node.fileStatus === 'FAILED') {
        throw new Error(`[shopify-files] ${node.id} fileStatus FAILED`);
      } else {
        stillPending.push(node.id);
      }
    }
    pending = stillPending;
    if (pending.length === 0) break;
    await new Promise((r) => setTimeout(r, delay));
    delay = Math.min(delay * 1.5, READY_POLL_MAX_MS);
  }

  if (pending.length > 0) {
    throw new Error(
      `[shopify-files] ${pending.length} file(s) did not reach READY within ${READY_TIMEOUT_MS}ms: ${pending.join(', ')}`,
    );
  }
  return ready;
}

// ─── Public batch upload ────────────────────────────────────────────────────

/**
 * Uploads N buffers in one staged-uploads call, parallel POSTs, one
 * fileCreate, and one batched poll. Either every file lands READY and a
 * full result array is returned, OR an error is thrown AFTER best-effort
 * deletion of any file IDs that did materialise (no orphans).
 */
export async function uploadShopifyFilesBatch(
  inputs: UploadInput[],
): Promise<ShopifyUploadResult[]> {
  if (inputs.length === 0) return [];
  if (inputs.length > 250) {
    throw new Error(
      `[shopify-files] batch size ${inputs.length} exceeds 250-file limit`,
    );
  }

  // Pre-resize all buffers in parallel before staging — Shopify will
  // reject any that exceed the file/megapixel caps with a userError, and
  // we'd rather catch it locally with a clean error.
  const sized = await Promise.all(
    inputs.map(async (i) => ({
      ...i,
      buffer: await resizeForShopifyFiles(i.buffer, i.mimeType),
    })),
  );

  const targets = await stageFiles(
    sized.map((s) => ({
      filename: s.filename,
      mimeType: s.mimeType,
      fileSize: String(s.buffer.byteLength),
    })),
  );

  // Parallel byte uploads. If any fails, the staged targets just
  // expire — no Shopify file IDs created yet, no cleanup needed.
  await Promise.all(
    sized.map((s, i) =>
      postBytesToStagedTarget(targets[i], s.filename, s.mimeType, s.buffer),
    ),
  );

  // Single fileCreate registers all files. Up to here, no IDs exist;
  // any throw skips the cleanup.
  const ids = await fileCreateBatch(
    sized.map((s, i) => ({
      originalSource: targets[i].resourceUrl,
      contentType: s.mimeType.startsWith('image/') ? 'IMAGE' : 'FILE',
      alt: s.alt,
      filename: s.filename,
      duplicateResolutionMode: s.duplicateResolutionMode ?? 'REPLACE',
    })),
  );

  // Poll. On any failure (timeout, FAILED status, malformed response),
  // best-effort delete every ID we created so Shopify Files doesn't
  // accumulate orphans.
  let urls: Map<string, string>;
  try {
    urls = await waitUntilAllReady(ids);
  } catch (error) {
    await bestEffortDelete(ids);
    throw error;
  }

  return ids.map((id, i) => {
    const url = urls.get(id);
    if (!url) {
      // Should be impossible after waitUntilAllReady; defensive.
      throw new Error(`[shopify-files] missing URL for id ${id}`);
    }
    return { id, url, filename: sized[i].filename };
  });
}

/**
 * Single-file convenience wrapper around `uploadShopifyFilesBatch`.
 * Use the batch primitive directly for tile uploads to amortise the
 * GraphQL round trips.
 */
export async function uploadShopifyFile(
  filename: string,
  mimeType: string,
  buffer: Buffer,
  options: {
    alt?: string;
    contentType?: 'IMAGE' | 'FILE';
    duplicateResolutionMode?: 'REPLACE' | 'APPEND_UUID' | 'RAISE_ERROR';
  } = {},
): Promise<ShopifyUploadResult> {
  const [out] = await uploadShopifyFilesBatch([
    {
      filename,
      mimeType,
      buffer,
      alt: options.alt,
      duplicateResolutionMode: options.duplicateResolutionMode,
    },
  ]);
  return out;
}

// ─── Lookup ─────────────────────────────────────────────────────────────────

/**
 * Find a single file by exact filename. Returns the most recent match
 * (sortKey: CREATED_AT, reverse: true) or null. Used by the legacy
 * `getObject(bucket, key)` shim and admin cleanup paths.
 */
export async function findShopifyFileByFilename(
  filename: string,
): Promise<ShopifyUploadResult | null> {
  const data = await shopifyAdminFetch<{
    files: {
      edges: Array<{ node: FileNode }>;
    };
  }>({
    query: `
      query FindByFilename($q: String!) {
        files(first: 1, query: $q, sortKey: CREATED_AT, reverse: true) {
          edges {
            node {
              ... on MediaImage {
                id
                fileStatus
                alt
                image { url }
                preview { image { url } }
              }
              ... on GenericFile {
                id
                fileStatus
                alt
                url
              }
            }
          }
        }
      }
    `,
    variables: { q: `filename:${filename}` },
  });
  const node = data.files.edges[0]?.node;
  if (!node) return null;
  const url = urlOfNode(node);
  if (!url) return null;
  return { id: node.id, url, filename };
}

/**
 * Bulk filename-prefix listing. Used by deferred admin tooling. Auto-paginates
 * to 250 hits; production code should not depend on this for integrity logic.
 */
export async function listShopifyFilesByPrefix(
  prefix: string,
  limit = 250,
): Promise<ShopifyUploadResult[]> {
  const data = await shopifyAdminFetch<{
    files: {
      edges: Array<{ node: FileNode }>;
      pageInfo: { hasNextPage: boolean };
    };
  }>({
    query: `
      query ListByPrefix($q: String!, $first: Int!) {
        files(first: $first, query: $q, sortKey: CREATED_AT, reverse: true) {
          edges {
            node {
              ... on MediaImage {
                id
                fileStatus
                alt
                image { url }
                preview { image { url } }
              }
              ... on GenericFile {
                id
                fileStatus
                alt
                url
              }
            }
          }
          pageInfo { hasNextPage }
        }
      }
    `,
    variables: { q: `filename:${prefix}*`, first: Math.min(limit, 250) },
  });
  return data.files.edges.flatMap((e) => {
    const url = urlOfNode(e.node);
    if (!url) return [];
    let filename = '';
    try {
      const u = new URL(url);
      filename = decodeURIComponent(u.pathname.split('/').pop() ?? '');
    } catch {
      filename = '';
    }
    return [{ id: e.node.id, url, filename }];
  });
}

// ─── Deletion ───────────────────────────────────────────────────────────────

export async function deleteShopifyFileById(id: string): Promise<void> {
  const data = await shopifyAdminFetch<{
    fileDelete: {
      deletedFileIds: string[];
      userErrors: Array<{ field: string[]; message: string }>;
    };
  }>({
    query: `
      mutation FileDelete($fileIds: [ID!]!) {
        fileDelete(fileIds: $fileIds) {
          deletedFileIds
          userErrors { field message }
        }
      }
    `,
    variables: { fileIds: [id] },
  });
  if (data.fileDelete.userErrors.length > 0) {
    throw new Error(
      `[shopify-files] fileDelete userErrors: ${JSON.stringify(
        data.fileDelete.userErrors,
      )}`,
    );
  }
}

async function bestEffortDelete(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const settled = await Promise.allSettled(
    ids.map((id) => deleteShopifyFileById(id)),
  );
  for (const s of settled) {
    if (s.status === 'rejected') {
      console.warn(
        `[shopify-files] best-effort delete failed (orphan possible): ${s.reason instanceof Error ? s.reason.message : String(s.reason)}`,
      );
    }
  }
}

/**
 * Delete by filename. One extra GraphQL call for the lookup. No-op if
 * the file does not exist (idempotent).
 */
export async function deleteShopifyFileByFilename(
  filename: string,
): Promise<void> {
  const found = await findShopifyFileByFilename(filename);
  if (!found) return;
  await deleteShopifyFileById(found.id);
}

// ─── URL → filename ─────────────────────────────────────────────────────────

/**
 * Extracts the filename from a Shopify Files CDN URL.
 *
 *   https://cdn.shopify.com/s/files/1/0984/4562/3587/files/<filename>?v=...
 *
 * Returns null for non-Shopify URLs, malformed URLs, or paths that don't
 * include the `/files/` segment. The returned filename is decoded
 * (`%2F` etc. resolved) so downstream regex matchers can rely on
 * literal characters.
 */
export function shopifyCdnUrlFilename(url: string): string | null {
  try {
    const u = new URL(url);
    // Codex audit (medium): enforce the FULL origin, not just hostname.
    // Hostname-only would accept `http://cdn.shopify.com/...` (downgrade
    // attack) and `cdn.shopify.com:8443` (port confusion). The Shopify
    // CDN canonical form is `https://cdn.shopify.com` on the default
    // port; anything else is suspicious.
    if (u.origin !== 'https://cdn.shopify.com') return null;
    // The Shopify Files namespace path is always
    //   /s/files/<shop-segment>/files/<filename>
    // where <shop-segment> is `<digit>/<digits>/<digits>/<digits>` (the
    // tenant ID hierarchy). Anything outside this shape is not a Files
    // URL even if it happens to contain `/files/` (e.g. a product image
    // path uses `/products/` and may not include `/files/` at all).
    const m = /^\/s\/files\/[^/]+(?:\/[^/]+){0,3}\/files\/([^/]+)$/.exec(u.pathname);
    if (!m) return null;
    const decoded = decodeURIComponent(m[1]);
    // Reject filenames containing path separators after decoding (a
    // tampered URL could encode `/` to bypass the basename split).
    if (decoded.includes('/') || decoded.includes('\\')) return null;
    return decoded;
  } catch {
    return null;
  }
}

// ─── Re-export ──────────────────────────────────────────────────────────────

export { getAdminAccessToken, SHOPIFY_API_VERSION };
