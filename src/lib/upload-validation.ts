/**
 * Single source of truth for image-upload validation.
 *
 * Used by both `/api/upload` (customer-facing builder) and
 * `/api/admin/products/analyze` (admin product CRUD) so the magic-byte
 * allowlist, size cap, and error catalog can never drift.
 *
 * UAT-3 B6 + J13 context: iOS Safari's camera-capture default is HEIC
 * (since iOS 11), but the magic-byte allowlist accepts only JPEG / PNG /
 * WebP. Clients hit an opaque "upload failed" banner. The fix:
 *   1. Detect HEIC specifically and return an actionable localized error
 *      (Spanish: tells the user how to switch iOS to JPG, or upload from
 *      gallery).
 *   2. Bump size cap to 20 MB to match Shopify Files' limit and the
 *      client-side cap already advertised in the UI.
 *   3. Return `{code, message}` envelope so the client can prefer its
 *      localized catalog by code, with the server message as fallback.
 *
 * Per Codex's plan (refactor audit + Phase 2 authority): no server-side
 * sharp HEIC decode — Vercel's prebuilt sharp binaries don't ship with
 * libheif. Localized error path only.
 */

/** Canonical max upload size — matches Shopify Files' own 20 MB cap. */
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

/** Image formats accepted by the print pipeline (after Sharp decode). */
export const ACCEPTED_FORMATS = [
  { prefix: [0xff, 0xd8, 0xff], type: 'image/jpeg', extension: 'jpg' },
  { prefix: [0x89, 0x50, 0x4e, 0x47], type: 'image/png', extension: 'png' },
  // WebP: RIFF header + "WEBP" tag at bytes 8-11. Verified separately.
  { prefix: [0x52, 0x49, 0x46, 0x46], type: 'image/webp', extension: 'webp' },
] as const;

/** HEIC/HEIF brand codes that may appear in real-world uploads.
 *  All start with `ftyp` at bytes 4-7, brand code at bytes 8-11.
 *  iOS camera capture emits a subset of these; the full list covers
 *  the IANA registrations for `image/heic` + `image/heic-sequence` so
 *  the detector won't miss a variant from a future iOS or Android
 *  device. Codex audit (Phase 2): added `heim`, `heis`, `hevm`, `hevs`
 *  for standards completeness. */
const HEIC_BRANDS = [
  'heic',
  'heix',
  'hevc',
  'hevx',
  'mif1',
  'heif',
  'msf1',
  'heim',
  'heis',
  'hevm',
  'hevs',
];

/** Validation-only codes (magic-bytes + size). Built by `uploadError()`
 *  with localized Spanish defaults. */
export type UploadValidationErrorCode =
  | 'NO_FILE'
  | 'FILE_TOO_LARGE'
  | 'UNSUPPORTED_HEIC'
  | 'UNSUPPORTED_TYPE';

/** Full set of codes the upload API surface returns. Routes layer
 *  additional non-validation codes (rate limit, auth, internal) on top
 *  of the validation set. Centralized so the client can map every code
 *  to localized copy in one place. Codex Phase 2 audit: consolidate. */
export type UploadApiErrorCode =
  | UploadValidationErrorCode
  | 'RATE_LIMITED'
  | 'UNAUTHORIZED'
  | 'INTERNAL_ERROR';

export interface UploadErrorPayload {
  code: UploadValidationErrorCode;
  /** Spanish default message — the client prefers its own catalog by
   *  `code`, but if a new code ships without a catalog entry the
   *  message is still actionable. */
  message: string;
}

/** Spanish-language default messages. Mexican-Spanish phrasing. */
const ES_MESSAGES: Record<UploadValidationErrorCode, string> = {
  NO_FILE: 'No se recibió ningún archivo.',
  FILE_TOO_LARGE: `El archivo excede el límite de ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB.`,
  UNSUPPORTED_HEIC:
    'Las fotos HEIC del iPhone no son compatibles. Cambia tu cámara a JPG en Ajustes → Cámara → Formatos → Más compatible, o sube la foto desde tu galería.',
  UNSUPPORTED_TYPE:
    'Formato no soportado. Sube una imagen JPG, PNG o WebP.',
};

export function uploadError(code: UploadValidationErrorCode): UploadErrorPayload {
  return { code, message: ES_MESSAGES[code] };
}

export const UPLOAD_ERROR_STATUS: Record<UploadValidationErrorCode, number> = {
  NO_FILE: 400,
  FILE_TOO_LARGE: 400,
  UNSUPPORTED_HEIC: 400,
  UNSUPPORTED_TYPE: 400,
};

/** Result of probing the first few bytes of an uploaded buffer. */
export type DetectResult =
  | { kind: 'accepted'; type: string; extension: string }
  | { kind: 'heic' }
  | { kind: 'unknown' };

/** Inspect the magic bytes of the buffer.
 *  Returns an `accepted` result for JPEG / PNG / WebP, `heic` for any
 *  detected HEIC/HEIF brand, otherwise `unknown`. */
export function detectImageType(buffer: Buffer): DetectResult {
  for (const fmt of ACCEPTED_FORMATS) {
    if (fmt.prefix.every((byte, i) => buffer[i] === byte)) {
      if (fmt.type === 'image/webp') {
        const webpTag = buffer.subarray(8, 12).toString('ascii');
        if (webpTag !== 'WEBP') continue;
      }
      return { kind: 'accepted', type: fmt.type, extension: fmt.extension };
    }
  }

  // HEIC detection: bytes 4-7 = 'ftyp', bytes 8-11 = brand code.
  if (buffer.length >= 12) {
    const ftypTag = buffer.subarray(4, 8).toString('ascii');
    if (ftypTag === 'ftyp') {
      const brand = buffer.subarray(8, 12).toString('ascii');
      if (HEIC_BRANDS.includes(brand)) {
        return { kind: 'heic' };
      }
    }
  }

  return { kind: 'unknown' };
}

/** Convert a `DetectResult.unknown` or `.heic` into the right error
 *  envelope. `accepted` shouldn't reach this helper. */
export function resultToError(result: DetectResult): UploadErrorPayload {
  if (result.kind === 'heic') return uploadError('UNSUPPORTED_HEIC');
  return uploadError('UNSUPPORTED_TYPE');
}

/** Type guard for the union of API error codes — useful in the client
 *  catalog when narrowing an arbitrary string from a server response. */
export function isUploadApiErrorCode(value: unknown): value is UploadApiErrorCode {
  return (
    typeof value === 'string' &&
    [
      'NO_FILE',
      'FILE_TOO_LARGE',
      'UNSUPPORTED_HEIC',
      'UNSUPPORTED_TYPE',
      'RATE_LIMITED',
      'UNAUTHORIZED',
      'INTERNAL_ERROR',
    ].includes(value)
  );
}
