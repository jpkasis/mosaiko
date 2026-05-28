/**
 * UAT-3 Phase 2 contract test: upload-validation magic-bytes detection
 * + error envelope shape.
 *
 * Locks the contract that:
 *   - JPEG, PNG, WebP buffers detect as `accepted`
 *   - HEIC (every iOS brand variant) detects as `heic` → 'UNSUPPORTED_HEIC'
 *   - Other types (PDF, MP4, random bytes) detect as `unknown` →
 *     'UNSUPPORTED_TYPE'
 *   - Size cap is 20 MB (canonical, matches Shopify Files)
 *   - Error envelope shape is { code, message } with Spanish copy
 *
 * Why these matter: B6 (iOS camera HEIC rejection) surfaced as an opaque
 * "upload failed" banner on production because the server only returned
 * `{ error: string }`. The new envelope lets the client either render
 * the server message verbatim OR look up its own localized copy by
 * `code`.
 */
import { describe, test, expect } from 'vitest';
import {
  ACCEPTED_FORMATS,
  MAX_UPLOAD_BYTES,
  UPLOAD_ERROR_STATUS,
  detectImageType,
  isUploadApiErrorCode,
  resultToError,
  uploadError,
} from '@/lib/upload-validation';

/** Build a buffer whose first N bytes match a magic-bytes prefix. */
function bufferWithPrefix(
  prefix: readonly number[],
  trailer: readonly number[] = [],
): Buffer {
  return Buffer.from([...prefix, ...trailer, ...new Array(64).fill(0)]);
}

describe('detectImageType — accepted formats (UAT-3 Phase 2)', () => {
  test('JPEG (FF D8 FF) → accepted', () => {
    const buf = bufferWithPrefix([0xff, 0xd8, 0xff, 0xe0]);
    const result = detectImageType(buf);
    expect(result).toEqual({
      kind: 'accepted',
      type: 'image/jpeg',
      extension: 'jpg',
    });
  });

  test('PNG (89 50 4E 47) → accepted', () => {
    const buf = bufferWithPrefix([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);
    const result = detectImageType(buf);
    expect(result).toEqual({
      kind: 'accepted',
      type: 'image/png',
      extension: 'png',
    });
  });

  test('WebP (RIFF + WEBP at offset 8) → accepted', () => {
    // Bytes 0-3: "RIFF", bytes 4-7: filesize (any), bytes 8-11: "WEBP"
    const buf = Buffer.from([
      0x52, 0x49, 0x46, 0x46, // RIFF
      0x00, 0x00, 0x00, 0x00, // size
      0x57, 0x45, 0x42, 0x50, // WEBP
      ...new Array(48).fill(0),
    ]);
    const result = detectImageType(buf);
    expect(result).toEqual({
      kind: 'accepted',
      type: 'image/webp',
      extension: 'webp',
    });
  });

  test('RIFF without WEBP tag → unknown (not WebP)', () => {
    // Bytes 0-3 RIFF but 8-11 NOT "WEBP" — should NOT be accepted as WebP.
    const buf = Buffer.from([
      0x52, 0x49, 0x46, 0x46,
      0x00, 0x00, 0x00, 0x00,
      0x41, 0x56, 0x49, 0x20, // "AVI " — RIFF wrapper for AVI
      ...new Array(48).fill(0),
    ]);
    expect(detectImageType(buf).kind).toBe('unknown');
  });

  test('All ACCEPTED_FORMATS round-trip through detection', () => {
    for (const fmt of ACCEPTED_FORMATS) {
      const trailer =
        fmt.type === 'image/webp'
          ? [0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50]
          : [];
      const buf = bufferWithPrefix(fmt.prefix, trailer);
      const result = detectImageType(buf);
      expect(result.kind).toBe('accepted');
      if (result.kind === 'accepted') {
        expect(result.type).toBe(fmt.type);
        expect(result.extension).toBe(fmt.extension);
      }
    }
  });
});

describe('detectImageType — HEIC variants (UAT-3 B6)', () => {
  // iOS Safari camera-capture HEIC files start with an ftyp box at
  // bytes 4-7, brand code at bytes 8-11. All of these are valid iOS
  // HEIC/HEIF brand codes the server must distinguish from generic
  // "unknown" so we can return UNSUPPORTED_HEIC with actionable copy.
  // The list extends past iOS-emitted brands to cover the full IANA
  // registration for image/heic + image/heic-sequence (Codex audit).
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

  test.each(HEIC_BRANDS)('HEIC brand "%s" → heic', (brand) => {
    const buf = Buffer.from([
      0x00, 0x00, 0x00, 0x20, // box size (any)
      0x66, 0x74, 0x79, 0x70, // "ftyp"
      ...Buffer.from(brand, 'ascii'),
      ...new Array(48).fill(0),
    ]);
    expect(detectImageType(buf)).toEqual({ kind: 'heic' });
  });

  test('ftyp box with non-HEIC brand → unknown', () => {
    // mp4 ftyp box ("isom"/"mp42"/etc) should NOT register as HEIC.
    const buf = Buffer.from([
      0x00, 0x00, 0x00, 0x20,
      0x66, 0x74, 0x79, 0x70, // ftyp
      0x69, 0x73, 0x6f, 0x6d, // isom (MP4)
      ...new Array(48).fill(0),
    ]);
    expect(detectImageType(buf).kind).toBe('unknown');
  });
});

describe('detectImageType — rejected formats', () => {
  test('random garbage → unknown', () => {
    const buf = Buffer.from([0x01, 0x02, 0x03, 0x04, 0x05]);
    expect(detectImageType(buf).kind).toBe('unknown');
  });

  test('empty buffer → unknown', () => {
    const buf = Buffer.alloc(0);
    expect(detectImageType(buf).kind).toBe('unknown');
  });

  test('PDF (%PDF) → unknown', () => {
    const buf = Buffer.from('%PDF-1.4\n', 'ascii');
    expect(detectImageType(buf).kind).toBe('unknown');
  });
});

describe('Error envelope contract (UAT-3 Phase 2 — Codex audit)', () => {
  test('uploadError returns { code, message } with Spanish message', () => {
    const err = uploadError('UNSUPPORTED_HEIC');
    expect(err.code).toBe('UNSUPPORTED_HEIC');
    expect(typeof err.message).toBe('string');
    // Spanish copy must include actionable iPhone hint
    expect(err.message).toMatch(/HEIC/);
    expect(err.message).toMatch(/iPhone|galer/i);
  });

  test('all UploadErrorCode values map to non-empty messages', () => {
    const codes = [
      'NO_FILE',
      'FILE_TOO_LARGE',
      'UNSUPPORTED_HEIC',
      'UNSUPPORTED_TYPE',
    ] as const;
    for (const code of codes) {
      const err = uploadError(code);
      expect(err.code).toBe(code);
      expect(err.message.length).toBeGreaterThan(0);
    }
  });

  test('FILE_TOO_LARGE message mentions the canonical 20 MB cap', () => {
    const err = uploadError('FILE_TOO_LARGE');
    expect(err.message).toMatch(/20 MB/);
  });

  test('resultToError maps detect results to the right code', () => {
    expect(resultToError({ kind: 'heic' }).code).toBe('UNSUPPORTED_HEIC');
    expect(resultToError({ kind: 'unknown' }).code).toBe('UNSUPPORTED_TYPE');
  });

  test('UPLOAD_ERROR_STATUS maps every code to 400', () => {
    expect(UPLOAD_ERROR_STATUS.NO_FILE).toBe(400);
    expect(UPLOAD_ERROR_STATUS.FILE_TOO_LARGE).toBe(400);
    expect(UPLOAD_ERROR_STATUS.UNSUPPORTED_HEIC).toBe(400);
    expect(UPLOAD_ERROR_STATUS.UNSUPPORTED_TYPE).toBe(400);
  });
});

describe('Canonical size cap (UAT-3 Phase 2 — Codex authority)', () => {
  test('MAX_UPLOAD_BYTES is 20 MB (matches Shopify Files cap + client UI copy)', () => {
    expect(MAX_UPLOAD_BYTES).toBe(20 * 1024 * 1024);
  });
});

describe('UploadApiErrorCode type guard (Codex Phase 2 audit)', () => {
  test.each([
    'NO_FILE',
    'FILE_TOO_LARGE',
    'UNSUPPORTED_HEIC',
    'UNSUPPORTED_TYPE',
    'RATE_LIMITED',
    'UNAUTHORIZED',
    'INTERNAL_ERROR',
  ])('isUploadApiErrorCode("%s") === true', (code) => {
    expect(isUploadApiErrorCode(code)).toBe(true);
  });

  test.each([
    'random',
    '',
    'unsupported_heic', // case-sensitive
    null,
    undefined,
    42,
    {},
  ])('isUploadApiErrorCode(%o) === false', (value) => {
    expect(isUploadApiErrorCode(value)).toBe(false);
  });
});
