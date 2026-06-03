import bcrypt from 'bcryptjs';
import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';
import { getShopMetafield } from '@/lib/shopify/queries/shop';

// ─── Constants ──────────────────────────────────────────────────────────────

const COOKIE_NAME = 'mosaiko-admin-session';
const SESSION_DURATION = 24 * 60 * 60; // 24 hours in seconds

// UAT-6 PR4: the admin password hash can be changed in-app. The override
// lives in a Shop metafield; the env var is the bootstrap fallback.
export const ADMIN_PASSWORD_METAFIELD_NAMESPACE = 'mosaiko_admin';
export const ADMIN_PASSWORD_METAFIELD_KEY = 'password_hash';
const ADMIN_PASSWORD_HASH_TTL_MS = 5 * 60 * 1000; // 5 min

function getJwtSecret(): Uint8Array {
  const secret = process.env.ADMIN_JWT_SECRET;
  if (!secret) {
    throw new Error('[admin/auth] ADMIN_JWT_SECRET not configured');
  }
  return new TextEncoder().encode(secret);
}

function envPasswordHash(): string {
  const hash = process.env.ADMIN_PASSWORD_HASH;
  if (!hash) {
    throw new Error('[admin/auth] ADMIN_PASSWORD_HASH not configured');
  }
  return hash;
}

function shopifyAdminAvailable(): boolean {
  return Boolean(
    process.env.SHOPIFY_ADMIN_API_TOKEN ||
      (process.env.SHOPIFY_CLIENT_ID && process.env.SHOPIFY_CLIENT_SECRET),
  );
}

// ─── Password-hash cache (blocking TTL, fail-closed) ─────────────────────────
//
// Codex PR4 audit MAJOR: do NOT use `unstable_cache` here. App Router's
// `unstable_cache` is stale-while-revalidate — on TTL expiry it serves the
// STALE value and refreshes in the BACKGROUND, swallowing any error. If the
// admin rotated their password in-app and Shopify then has an outage when the
// TTL lapses, the OLD hash could keep being served (fail OPEN). That's a
// security regression.
//
// A module-level blocking TTL cache instead: on expiry, the next call does a
// BLOCKING Shopify read and PROPAGATES errors (never serves stale on a failed
// refresh). Per-instance — cross-instance freshness is bounded by the TTL,
// and the change-password route clears the local cache via
// `clearPasswordHashCache()` so the admin sees their change immediately.

let passwordHashCache: { hash: string | null; expiresAt: number } | null = null;

/** Clears the local password-hash cache. Called by the change-password
 *  route after a successful write so the next verify on this instance reads
 *  the new value immediately. */
export function clearPasswordHashCache(): void {
  passwordHashCache = null;
}

async function readShopPasswordHash(): Promise<string | null> {
  const now = Date.now();
  if (passwordHashCache && passwordHashCache.expiresAt > now) {
    return passwordHashCache.hash;
  }
  // Expired or cold → blocking fresh read. Errors PROPAGATE (we never cache
  // a failure and never serve a stale value on a failed refresh).
  const hash = await getShopMetafield(
    ADMIN_PASSWORD_METAFIELD_NAMESPACE,
    ADMIN_PASSWORD_METAFIELD_KEY,
  );
  passwordHashCache = { hash, expiresAt: now + ADMIN_PASSWORD_HASH_TTL_MS };
  return hash;
}

/**
 * Resolves the active admin password hash with this precedence:
 *   1. Shopify Admin unavailable (no creds) → env hash
 *   2. Shop metafield exists + non-empty → metafield hash (in-app override wins)
 *   3. Shop metafield absent/empty → env hash (bootstrap)
 *
 * FAIL CLOSED: if Shopify Admin IS configured but the metafield read THROWS
 * (network/auth/outage), we re-throw rather than silently using the old env
 * hash. The login + change routes surface this as a 5xx (deny), never a
 * silent allow.
 */
export async function getPasswordHash(): Promise<string> {
  if (!shopifyAdminAvailable()) {
    return envPasswordHash();
  }
  const metafieldHash = await readShopPasswordHash(); // may throw → fail closed
  if (metafieldHash && metafieldHash.trim().length > 0) {
    return metafieldHash.trim();
  }
  return envPasswordHash();
}

// ─── Password verification ──────────────────────────────────────────────────

export async function verifyPassword(password: string): Promise<boolean> {
  const hash = await getPasswordHash();
  return bcrypt.compare(password, hash);
}

// ─── Session management ─────────────────────────────────────────────────────

export async function createSession(): Promise<string> {
  const secret = getJwtSecret();

  const token = await new SignJWT({ role: 'admin' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DURATION}s`)
    .sign(secret);

  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: SESSION_DURATION,
    path: '/',
  });

  return token;
}

export async function verifySession(): Promise<boolean> {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get(COOKIE_NAME)?.value;
    if (!token) return false;

    const secret = getJwtSecret();
    await jwtVerify(token, secret);
    return true;
  } catch {
    return false;
  }
}

export async function clearSession(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_NAME);
}

// ─── Helper to generate password hash (run once) ────────────────────────────
// Use this to generate the hash for ADMIN_PASSWORD_HASH env var:
//   node -e "const bcrypt = require('bcryptjs'); bcrypt.hash('your-password', 12).then(h => console.log(h))"
