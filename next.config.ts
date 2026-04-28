import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const nextConfig: NextConfig = {
  // Sharp + napi-rs/canvas are native modules — exclude from server
  // bundling so Vercel uses the prebuilt binaries instead of trying to
  // bundle them through Webpack.
  serverExternalPackages: ['sharp', '@napi-rs/canvas'],
  // Phase 4 — server-side font fidelity. The print-pipeline functions
  // need the bundled @fontsource WOFF2 files at runtime so canvas's
  // GlobalFonts.registerFromPath can load them. Next's tracing finds
  // package code via `require.resolve`, but assets next to it don't
  // automatically come along. Explicitly include the WOFF2s for every
  // print-pipeline-touching route + the lib itself.
  //
  // Codex final-audit MAJOR fix: glob is scoped to the EXACT 17 files
  // registered in `font-loader.ts` (subset+weight matches FONT_REGISTRY).
  // The prior `files/*.woff2` glob traced ~1494 WOFF2 variants (~37 MB
  // of unused weights/subsets per route), mostly Noto Sans JP unicode
  // subsets we don't register. Scoping cuts deploy size + cold-start
  // I/O while still including every file `font-loader.ts` resolves.
  // If you add a font/weight to FONT_REGISTRY, mirror it here.
  outputFileTracingIncludes: {
    // Latin 400/700 across the 9 Latin families. Packages that ship
    // only one weight (great-vibes 400, tenor-sans 400) are covered
    // because the glob only materializes files that exist.
    '/api/webhooks/shopify': [
      './node_modules/@fontsource/{cinzel,cormorant-garamond,dancing-script,dm-sans,great-vibes,montserrat,playfair-display,source-sans-3,tenor-sans}/files/*-latin-{400,700}-normal.woff2',
      './node_modules/@fontsource/noto-sans-jp/files/noto-sans-jp-japanese-400-normal.woff2',
    ],
    '/api/cart-composite': [
      './node_modules/@fontsource/{cinzel,cormorant-garamond,dancing-script,dm-sans,great-vibes,montserrat,playfair-display,source-sans-3,tenor-sans}/files/*-latin-{400,700}-normal.woff2',
      './node_modules/@fontsource/noto-sans-jp/files/noto-sans-jp-japanese-400-normal.woff2',
    ],
    '/api/generate-print': [
      './node_modules/@fontsource/{cinzel,cormorant-garamond,dancing-script,dm-sans,great-vibes,montserrat,playfair-display,source-sans-3,tenor-sans}/files/*-latin-{400,700}-normal.woff2',
      './node_modules/@fontsource/noto-sans-jp/files/noto-sans-jp-japanese-400-normal.woff2',
    ],
    '/api/admin/orders/[orderId]/retry': [
      './node_modules/@fontsource/{cinzel,cormorant-garamond,dancing-script,dm-sans,great-vibes,montserrat,playfair-display,source-sans-3,tenor-sans}/files/*-latin-{400,700}-normal.woff2',
      './node_modules/@fontsource/noto-sans-jp/files/noto-sans-jp-japanese-400-normal.woff2',
    ],
  },
  images: {
    qualities: [75, 90],
    formats: ['image/avif', 'image/webp'],
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'cdn.shopify.com',
        pathname: '/s/files/**',
      },
      {
        protocol: 'https',
        hostname: 'r2.mosaiko.mx',
        pathname: '/**',
      },
    ],
  },
  async headers() {
    const securityHeaders = [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      {
        key: 'Content-Security-Policy',
        value: [
          "default-src 'self'",
          "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://www.googletagmanager.com https://www.google-analytics.com",
          "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
          "font-src 'self' https://fonts.gstatic.com",
          "img-src 'self' data: blob: https://cdn.shopify.com https://r2.mosaiko.mx https://www.google-analytics.com",
          "connect-src 'self' https://cdn.shopify.com https://r2.mosaiko.mx https://www.google-analytics.com https://www.googletagmanager.com",
          "frame-ancestors 'none'",
          "base-uri 'self'",
          "form-action 'self'",
        ].join('; '),
      },
    ];

    return [
      { source: '/(.*)', headers: securityHeaders },
    ];
  },
};

export default withNextIntl(nextConfig);
