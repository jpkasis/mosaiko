import { NextRequest, NextResponse } from 'next/server';
import { verifyPassword, createSession } from '@/lib/admin/auth';
import { checkLockout, recordFailure, clearFailures } from '@/lib/rate-limit';
import { clientIp, shortHash } from '@/lib/request-ip';

export async function POST(request: NextRequest) {
  // Brute-force lockout, keyed by hashed IP (5 failed passwords / 15 min →
  // 15-min lock). Checked BEFORE touching the password so a locked attacker
  // never reaches verifyPassword. In-memory + best-effort per Vercel instance;
  // a Cloudflare rule is the perimeter backstop.
  const lockKey = `admin-login:${shortHash(clientIp(request))}`;
  const lock = checkLockout(lockKey);
  if (lock.locked) {
    return NextResponse.json(
      { error: 'Demasiados intentos fallidos. Intenta de nuevo más tarde.' },
      {
        status: 429,
        headers: { 'Retry-After': String(Math.ceil(lock.retryAfterMs / 1000)) },
      },
    );
  }

  try {
    const { password } = await request.json();

    if (!password || typeof password !== 'string') {
      return NextResponse.json(
        { error: 'Contraseña requerida.' },
        { status: 400 },
      );
    }

    const isValid = await verifyPassword(password);

    if (!isValid) {
      // Only an actual wrong password counts toward the lock — infra errors
      // (verifyPassword throwing on a Shopify outage) fall through to the 500
      // below and are NOT recorded.
      recordFailure(lockKey);
      return NextResponse.json(
        { error: 'Contraseña incorrecta.' },
        { status: 401 },
      );
    }

    clearFailures(lockKey);
    await createSession();

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[api/admin/auth/login] Error:', error);
    return NextResponse.json(
      { error: 'Error al iniciar sesión.' },
      { status: 500 },
    );
  }
}
