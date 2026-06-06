/**
 * Canonical public origin of the storefront, used for metadataBase, canonical
 * URLs, robots.txt, and the sitemap.
 *
 * Phase 7: until the domain cutover, the production deployment is served from
 * the Vercel URL. At Phase 8 (launch), set `NEXT_PUBLIC_SITE_URL=https://mosaiko.mx`
 * in the Vercel project env and everything (canonicals, sitemap, OG) follows.
 * No trailing slash.
 */
export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL ?? 'https://mosaiko.vercel.app'
).replace(/\/+$/, '');
