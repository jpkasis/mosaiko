import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import {
  verifySession,
  verifyPassword,
  createSession,
  clearPasswordHashCache,
  ADMIN_PASSWORD_METAFIELD_NAMESPACE,
  ADMIN_PASSWORD_METAFIELD_KEY,
} from '@/lib/admin/auth';
import { getShopId } from '@/lib/shopify/queries/shop';
import { setShopMetafield } from '@/lib/shopify/mutations/shop-metafields';
import { ShopifyUserErrorsError } from '@/lib/shopify/mutations/metaobjects';

const MIN_LEN = 12;
const MAX_LEN = 128;
const BCRYPT_COST = 12;

interface FieldErrors {
  currentPassword?: string;
  newPassword?: string;
  confirmPassword?: string;
}

function unauthorized(): NextResponse {
  return NextResponse.json(
    { error: { code: 'UNAUTHORIZED', message: 'No autorizado.' } },
    { status: 401 },
  );
}

// ─── PUT /api/admin/configuracion/cuenta/password ────────────────────────────
//
// Changes the admin password. Validates the current password against the
// active hash (Shop metafield, env fallback), hashes the new one, writes it
// to the Shop metafield (mosaiko_admin/password_hash), busts the cached
// hash, and re-issues the current browser's session. Existing sessions on
// other devices remain valid until their 24h JWT expiry — global session
// invalidation would need shared infra (out of scope).

export async function PUT(request: Request): Promise<NextResponse> {
  if (!(await verifySession())) return unauthorized();

  let body: {
    currentPassword?: unknown;
    newPassword?: unknown;
    confirmPassword?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json(
      { error: { code: 'VALIDATION_ERROR', message: 'Cuerpo JSON inválido.' } },
      { status: 400 },
    );
  }

  const currentPassword = body.currentPassword;
  const newPassword = body.newPassword;
  const confirmPassword = body.confirmPassword;

  const fieldErrors: FieldErrors = {};
  if (typeof currentPassword !== 'string' || currentPassword.length === 0) {
    fieldErrors.currentPassword = 'La contraseña actual es obligatoria.';
  }
  if (typeof newPassword !== 'string' || newPassword.length === 0) {
    fieldErrors.newPassword = 'La nueva contraseña es obligatoria.';
  } else if (newPassword.length < MIN_LEN || newPassword.length > MAX_LEN) {
    fieldErrors.newPassword = `La nueva contraseña debe tener entre ${MIN_LEN} y ${MAX_LEN} caracteres.`;
  }
  if (typeof confirmPassword !== 'string' || confirmPassword.length === 0) {
    fieldErrors.confirmPassword = 'Confirma la nueva contraseña.';
  } else if (
    typeof newPassword === 'string' &&
    confirmPassword !== newPassword
  ) {
    fieldErrors.confirmPassword = 'Las contraseñas no coinciden.';
  }
  if (
    typeof newPassword === 'string' &&
    typeof currentPassword === 'string' &&
    newPassword.length > 0 &&
    newPassword === currentPassword
  ) {
    fieldErrors.newPassword =
      'La nueva contraseña debe ser diferente a la actual.';
  }

  if (Object.keys(fieldErrors).length > 0) {
    return NextResponse.json(
      { error: { code: 'VALIDATION_ERROR', fieldErrors } },
      { status: 400 },
    );
  }

  // Verify the current password against the active hash. getPasswordHash
  // fails closed on a Shopify outage, so a 500 here means "couldn't verify".
  let currentValid: boolean;
  try {
    currentValid = await verifyPassword(currentPassword as string);
  } catch (error) {
    console.error('[admin/cuenta/password] verify failed:', error);
    return NextResponse.json(
      {
        error: {
          code: 'SHOPIFY_WRITE_FAILED',
          message: 'No se pudo verificar la contraseña actual. Intenta de nuevo.',
        },
      },
      { status: 502 },
    );
  }
  if (!currentValid) {
    return NextResponse.json(
      {
        error: {
          code: 'CURRENT_PASSWORD_INCORRECT',
          message: 'La contraseña actual es incorrecta.',
        },
      },
      { status: 403 },
    );
  }

  // Hash the new password + persist to the Shop metafield.
  try {
    const newHash = await bcrypt.hash(newPassword as string, BCRYPT_COST);
    const shopId = await getShopId();
    await setShopMetafield(
      shopId,
      ADMIN_PASSWORD_METAFIELD_NAMESPACE,
      ADMIN_PASSWORD_METAFIELD_KEY,
      newHash,
    );
  } catch (error) {
    if (error instanceof ShopifyUserErrorsError) {
      return NextResponse.json(
        {
          error: {
            code: 'SHOPIFY_WRITE_FAILED',
            message: 'Shopify rechazó el cambio de contraseña.',
            details: error.userErrors,
          },
        },
        { status: 502 },
      );
    }
    console.error('[admin/cuenta/password] write failed:', error);
    return NextResponse.json(
      {
        error: {
          code: 'SHOPIFY_WRITE_FAILED',
          message: 'No se pudo guardar la nueva contraseña.',
        },
      },
      { status: 502 },
    );
  }

  // Clear the local password-hash cache so the next verify on this instance
  // reads the new value immediately. Other warm instances pick it up within
  // the 5-min TTL (via a blocking, fail-closed refresh). Re-issue this
  // browser's session (defensive — the JWT doesn't embed the password, but
  // refreshing keeps the UX clean post-change).
  clearPasswordHashCache();
  await createSession();

  return NextResponse.json({ ok: true });
}
