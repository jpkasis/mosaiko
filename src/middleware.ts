import createMiddleware from 'next-intl/middleware';
import { routing } from './i18n/routing';

export default createMiddleware(routing);

export const config = {
  matcher: [
    // Match all paths except: api, _next, _vercel, static assets, admin routes
    '/((?!api|_next|_vercel|admin|MOSAIKO-images|MOSAIKO-logos|.*\\..*).*)',
  ],
};
