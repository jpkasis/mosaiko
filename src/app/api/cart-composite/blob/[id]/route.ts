import { NextResponse } from 'next/server';
import { BLOB_ID_PATTERN, get as getBlob } from '@/lib/cart-composite-blob-cache';

/**
 * Serves the in-memory composite + thumb blobs stashed by the cart-composite
 * fallback path when Shopify Files is unreachable. Capability-based access via the
 * server-generated jobId (see /api/cart-composite route — 122 bits of
 * randomness, unenumerable).
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  if (!BLOB_ID_PATTERN.test(id)) {
    return NextResponse.json({ error: 'Invalid blob id' }, { status: 400 });
  }

  const hit = getBlob(id);
  if (!hit) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  return new NextResponse(new Uint8Array(hit.buffer), {
    status: 200,
    headers: {
      'Content-Type': hit.mime,
      'Content-Length': String(hit.buffer.length),
      'Cache-Control': 'private, max-age=0, must-revalidate',
      'X-Robots-Tag': 'noindex',
    },
  });
}
