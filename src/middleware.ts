import createMiddleware from 'next-intl/middleware';
import { NextResponse, type NextRequest } from 'next/server';
import { routing } from './i18n/routing';
import { SITE_URL } from './lib/site-url';
import { canonicalRedirectHost } from './lib/canonical-redirect';

const intlMiddleware = createMiddleware(routing);

// Only the production deployment should be indexable. Every preview/staging
// deployment (`VERCEL_ENV !== 'production'` — *.vercel.app preview URLs, local
// dev) gets an `X-Robots-Tag: noindex` header so it never competes with the
// real domain in search. robots.ts also returns a disallow-all there.
const IS_PRODUCTION = process.env.VERCEL_ENV === 'production';

// Phase 8: after the domain cutover, the bare production Vercel host
// (`mosaiko.vercel.app` — still VERCEL_ENV=production, so the noindex below does
// NOT cover it) 308-redirects to the canonical custom domain so it can't compete
// for SEO. NULL (no-op) until NEXT_PUBLIC_SITE_URL is a custom domain — today it
// is the Vercel URL, so this is inert.
const CANONICAL_HOST = canonicalRedirectHost(SITE_URL, process.env.VERCEL_ENV);

export default function middleware(request: NextRequest) {
  if (CANONICAL_HOST) {
    const host = request.headers.get('host');
    if (host && host !== CANONICAL_HOST) {
      const url = request.nextUrl.clone();
      url.protocol = 'https';
      url.hostname = CANONICAL_HOST;
      url.port = '';
      return NextResponse.redirect(url, 308);
    }
  }

  const response = intlMiddleware(request);
  if (!IS_PRODUCTION) {
    response.headers.set('X-Robots-Tag', 'noindex, nofollow');
  }
  return response;
}

export const config = {
  matcher: [
    // Match all paths except: api, _next, _vercel, static assets, admin
    // routes. UAT-3 Phase 4 (Codex audit A2): removed legacy
    // `MOSAIKO-images` and `MOSAIKO-logos` exclusions — those source
    // asset libraries never lived under `/public` and never reached the
    // i18n middleware in the first place.
    '/((?!api|_next|_vercel|admin|.*\\..*).*)',
  ],
};
