/**
 * Phase 8: the canonical custom host the storefront should redirect to, or
 * `null` when the redirect must be a no-op.
 *
 * Returns the host of `siteUrl` ONLY when (a) we're on the PRODUCTION deployment
 * and (b) that host is a real custom domain (not the `*.vercel.app` URL). Until
 * the domain cutover sets `NEXT_PUBLIC_SITE_URL` to `mosaiko.mx`, this stays
 * `null`, so the middleware host-redirect is inert. Pure → unit-tested.
 *
 * Why: after the cutover, `mosaiko.vercel.app` is still `VERCEL_ENV=production`,
 * so the preview-noindex does NOT cover it. To stop it competing with the real
 * domain in search, the bare Vercel host 308-redirects to the canonical apex.
 */
export function canonicalRedirectHost(
  siteUrl: string,
  vercelEnv: string | undefined,
): string | null {
  if (vercelEnv !== 'production') return null;
  let host: string;
  try {
    host = new URL(siteUrl).host;
  } catch {
    return null;
  }
  if (!host || host.endsWith('.vercel.app')) return null;
  return host;
}
