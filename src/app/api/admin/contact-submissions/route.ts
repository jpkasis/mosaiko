import { NextResponse } from 'next/server';
import { verifySession } from '@/lib/admin/auth';
import { isAdminConfigured } from '@/lib/shopify/client';
import {
  listContactSubmissions,
  updateContactSubmissionStatus,
} from '@/lib/shopify/mutations/contact-submissions';
import { ShopifyUserErrorsError } from '@/lib/shopify/mutations/metaobjects';

// ─── Admin Contactos inbox API ──────────────────────────────────────────────
//
// GET   → list submissions newest-first (session-guarded)
// PATCH → update a submission's status ("read" / "archived")

// Statuses the admin may set via PATCH.
const ALLOWED_STATUSES = new Set(['new', 'read', 'archived']);

function unauthorized(): NextResponse {
  return NextResponse.json(
    { error: { code: 'UNAUTHORIZED', message: 'No autorizado.' } },
    { status: 401 },
  );
}

export async function GET(): Promise<NextResponse> {
  if (!(await verifySession())) return unauthorized();

  if (!isAdminConfigured()) {
    return NextResponse.json({
      submissions: [],
      message:
        'Shopify no está configurado. Los mensajes aparecerán aquí cuando la tienda esté conectada.',
    });
  }

  try {
    const submissions = await listContactSubmissions({ first: 50 });
    return NextResponse.json({ submissions });
  } catch (error) {
    console.error('[api/admin/contact-submissions GET] failed:', error);
    return NextResponse.json(
      { error: { code: 'SHOPIFY_READ_FAILED', message: 'No se pudieron cargar los mensajes.' } },
      { status: 502 },
    );
  }
}

export async function PATCH(request: Request): Promise<NextResponse> {
  if (!(await verifySession())) return unauthorized();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: { code: 'VALIDATION_ERROR', message: 'Cuerpo JSON inválido.' } },
      { status: 400 },
    );
  }

  const obj =
    typeof body === 'object' && body !== null
      ? (body as Record<string, unknown>)
      : {};
  const id = obj.id;
  const status = obj.status;
  if (typeof id !== 'string' || !id) {
    return NextResponse.json(
      { error: { code: 'VALIDATION_ERROR', message: 'Falta el id.' } },
      { status: 400 },
    );
  }
  if (typeof status !== 'string' || !ALLOWED_STATUSES.has(status)) {
    return NextResponse.json(
      { error: { code: 'VALIDATION_ERROR', message: 'Estado no válido.' } },
      { status: 400 },
    );
  }

  try {
    await updateContactSubmissionStatus(id, status);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof ShopifyUserErrorsError) {
      return NextResponse.json(
        { error: { code: 'SHOPIFY_WRITE_FAILED', message: 'Shopify rechazó la actualización.', details: error.userErrors } },
        { status: 502 },
      );
    }
    console.error('[api/admin/contact-submissions PATCH] failed:', error);
    return NextResponse.json(
      { error: { code: 'SHOPIFY_WRITE_FAILED', message: 'No se pudo actualizar el mensaje.' } },
      { status: 502 },
    );
  }
}
