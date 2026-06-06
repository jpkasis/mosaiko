import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/site-url';

/**
 * Only the PRODUCTION deployment is crawlable. Preview/staging deployments
 * (`VERCEL_ENV !== 'production'` — every *.vercel.app preview URL, and local
 * dev) return a disallow-all robots.txt AND get an `X-Robots-Tag: noindex`
 * header from the middleware, so they never compete with the real domain in
 * search. Admin + API are always disallowed.
 */
export default function robots(): MetadataRoute.Robots {
  if (process.env.VERCEL_ENV !== 'production') {
    return { rules: { userAgent: '*', disallow: '/' } };
  }
  return {
    rules: { userAgent: '*', allow: '/', disallow: ['/admin', '/api/'] },
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
