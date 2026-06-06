/**
 * Phase 8: the bare-host→canonical-apex redirect must be INERT until the domain
 * cutover, and must never fire on previews or local dev. canonicalRedirectHost
 * is the gate; these pin its behavior so a production middleware change can't
 * silently start redirecting (or fail to redirect after cutover).
 */
import { describe, test, expect } from 'vitest';
import { canonicalRedirectHost } from '@/lib/canonical-redirect';

describe('canonicalRedirectHost', () => {
  test('production + custom domain → returns the host (redirect ACTIVE)', () => {
    expect(canonicalRedirectHost('https://mosaiko.mx', 'production')).toBe('mosaiko.mx');
    expect(canonicalRedirectHost('https://www.mosaiko.mx', 'production')).toBe('www.mosaiko.mx');
  });

  test("production + Vercel URL → null (NO-OP — today's state, before cutover)", () => {
    expect(canonicalRedirectHost('https://mosaiko.vercel.app', 'production')).toBeNull();
  });

  test('preview / non-production env → null (never redirect previews)', () => {
    expect(canonicalRedirectHost('https://mosaiko.mx', 'preview')).toBeNull();
    expect(canonicalRedirectHost('https://mosaiko.mx', 'development')).toBeNull();
  });

  test('no VERCEL_ENV (local dev) → null', () => {
    expect(canonicalRedirectHost('https://mosaiko.mx', undefined)).toBeNull();
  });

  test('malformed siteUrl → null (fails safe, no redirect)', () => {
    expect(canonicalRedirectHost('not-a-url', 'production')).toBeNull();
    expect(canonicalRedirectHost('', 'production')).toBeNull();
  });
});
