import { NextRequest, NextResponse } from 'next/server';
import { verifySession } from '@/lib/admin/auth';
import { detectSeams } from '@/lib/admin/seam-detection';
import { uploadBuffer } from '@/lib/storage';
import crypto from 'node:crypto';
import type { GridSize } from '@/lib/grid-config';
import {
  MAX_UPLOAD_BYTES,
  UPLOAD_ERROR_STATUS,
  detectImageType,
  resultToError,
  uploadError,
} from '@/lib/upload-validation';

// POST /api/admin/products/analyze
export async function POST(request: NextRequest) {
  const isAdmin = await verifySession();
  if (!isAdmin) {
    return NextResponse.json(
      { code: 'UNAUTHORIZED', message: 'No autorizado.' },
      { status: 401 },
    );
  }

  try {
    const formData = await request.formData();
    const file = formData.get('file');
    if (!file || !(file instanceof File)) {
      const err = uploadError('NO_FILE');
      return NextResponse.json(err, { status: UPLOAD_ERROR_STATUS.NO_FILE });
    }

    if (file.size > MAX_UPLOAD_BYTES) {
      const err = uploadError('FILE_TOO_LARGE');
      return NextResponse.json(err, {
        status: UPLOAD_ERROR_STATUS.FILE_TOO_LARGE,
      });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const detected = detectImageType(buffer);
    if (detected.kind !== 'accepted') {
      const err = resultToError(detected);
      return NextResponse.json(err, { status: UPLOAD_ERROR_STATUS[err.code] });
    }

    // Optional force grid from form data
    let forceGrid: { rows: number; cols: number; gridSize: GridSize } | undefined;
    const forceRows = formData.get('forceRows');
    const forceCols = formData.get('forceCols');
    const forceGridSize = formData.get('forceGridSize');
    if (forceRows && forceCols && forceGridSize) {
      forceGrid = {
        rows: Number(forceRows),
        cols: Number(forceCols),
        gridSize: Number(forceGridSize) as GridSize,
      };
    }

    // Run seam detection
    const detection = await detectSeams(buffer, forceGrid);

    // Upload temp image to Shopify Files (storage layer is generic)
    const tempKey = `catalog/images/temp-${crypto.randomUUID()}.${detected.extension}`;
    const { publicUrl } = await uploadBuffer('uploads', tempKey, buffer, detected.type);

    return NextResponse.json({
      tempImageKey: tempKey,
      publicUrl,
      contentType: detected.type,
      detection,
    });
  } catch (err) {
    console.error('[admin/products/analyze] Error:', err);
    return NextResponse.json(
      { code: 'INTERNAL_ERROR', message: 'Error al analizar imagen.' },
      { status: 500 },
    );
  }
}
