import { NextRequest, NextResponse } from 'next/server';
import { uploadOriginalPhoto } from '@/lib/storage';
import { checkRateLimit } from '@/lib/rate-limit';
import {
  MAX_UPLOAD_BYTES,
  UPLOAD_ERROR_STATUS,
  detectImageType,
  resultToError,
  uploadError,
} from '@/lib/upload-validation';

// ─── POST /api/upload ────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  // ── Rate limiting (10 burst, 1 per 5s sustained) ─────────────────────
  const clientIp = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const { allowed, retryAfterMs } = checkRateLimit(`upload:${clientIp}`);

  if (!allowed) {
    return NextResponse.json(
      {
        code: 'RATE_LIMITED',
        message: 'Demasiadas solicitudes. Intenta de nuevo en unos segundos.',
      },
      {
        status: 429,
        headers: { 'Retry-After': String(Math.ceil(retryAfterMs / 1000)) },
      },
    );
  }

  try {
    const formData = await request.formData();
    const file = formData.get('file');

    // ── Validate file exists ──────────────────────────────────────────────

    if (!file || !(file instanceof File)) {
      const err = uploadError('NO_FILE');
      return NextResponse.json(err, { status: UPLOAD_ERROR_STATUS.NO_FILE });
    }

    // ── Validate file size ────────────────────────────────────────────────

    if (file.size > MAX_UPLOAD_BYTES) {
      const err = uploadError('FILE_TOO_LARGE');
      return NextResponse.json(err, {
        status: UPLOAD_ERROR_STATUS.FILE_TOO_LARGE,
      });
    }

    // ── Convert to Buffer and validate via magic bytes ────────────────────

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const detected = detectImageType(buffer);
    if (detected.kind !== 'accepted') {
      // HEIC gets a distinct error code with iPhone-specific actionable
      // copy; other unknown types get the generic "unsupported".
      const err = resultToError(detected);
      return NextResponse.json(err, { status: UPLOAD_ERROR_STATUS[err.code] });
    }

    const { key, publicUrl } = await uploadOriginalPhoto(buffer, detected.extension);

    return NextResponse.json({ key, publicUrl }, { status: 201 });
  } catch (error) {
    console.error('[api/upload] Upload failed:', error);

    return NextResponse.json(
      {
        code: 'INTERNAL_ERROR',
        message: 'Error inesperado al subir la foto. Intenta de nuevo.',
      },
      { status: 500 },
    );
  }
}
