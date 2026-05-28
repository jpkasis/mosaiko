import createMiddleware from 'next-intl/middleware';
import { routing } from './i18n/routing';

export default createMiddleware(routing);

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
