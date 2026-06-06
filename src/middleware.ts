import createMiddleware from 'next-intl/middleware';
import type { NextRequest } from 'next/server';
import { routing } from './i18n/routing';

const intlMiddleware = createMiddleware(routing);

// Only the production deployment should be indexable. Every preview/staging
// deployment (`VERCEL_ENV !== 'production'` — *.vercel.app preview URLs, local
// dev) gets an `X-Robots-Tag: noindex` header so it never competes with the
// real domain in search. robots.ts also returns a disallow-all there.
const IS_PRODUCTION = process.env.VERCEL_ENV === 'production';

export default function middleware(request: NextRequest) {
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
