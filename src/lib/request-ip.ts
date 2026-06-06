import { createHash } from 'node:crypto';

/**
 * Best-effort client IP for rate-limit / lockout keying. Reads Vercel's
 * `x-forwarded-for` (the platform sets it to the real client IP and documents
 * it as the spoof-resistant client-IP header). Falls back to `'unknown'` (a
 * shared bucket) so callers can always key on a string. Shared by the
 * rate-limited routes (`/api/contact`, `/api/upload`, admin login) so this
 * logic lives in one place.
 *
 * We deliberately do NOT trust `cf-connecting-ip`: mosaiko.mx is DNS-only on
 * Cloudflare (no proxy in front), so requests reach Vercel directly and that
 * header is fully client-controlled — trusting it let an attacker rotate it to
 * mint a fresh lockout/rate-limit bucket per request (bypass). If Cloudflare
 * proxy is ever enabled (Part C), revisit: `cf-connecting-ip` would then be the
 * authoritative client IP and `x-forwarded-for` would carry Cloudflare's hop.
 */
export function clientIp(request: Request): string {
  const xff = request.headers.get('x-forwarded-for');
  if (xff) {
    const first = xff.split(',')[0]?.trim();
    if (first) return first;
  }
  return 'unknown';
}

/**
 * Short, stable SHA-256 hex prefix — for keying rate-limit / lockout buckets by
 * IP without storing the raw address. Not a security boundary (12 hex chars),
 * just a compact, non-PII bucket key.
 */
export function shortHash(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 12);
}
