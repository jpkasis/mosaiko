import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/site-url';

/**
 * Public, indexable routes only. Excludes cart, order-confirmed, dynamic
 * detail pages ([productId]/[itemId]), and the admin/api surfaces. Each route
 * carries hreflang alternates (es = default/unprefixed, en = /en + localized
 * slug, per `i18n/routing.ts` with localePrefix 'as-needed'). The slug map is
 * kept in sync with `routing.pathnames`.
 */
const ROUTES: ReadonlyArray<{ es: string; en: string; priority: number }> = [
  { es: '/', en: '/en', priority: 1.0 },
  { es: '/catalogo', en: '/en/catalog', priority: 0.8 },
  { es: '/personalizar', en: '/en/customize', priority: 0.9 },
  { es: '/nosotros', en: '/en/about', priority: 0.6 },
  { es: '/preguntas-frecuentes', en: '/en/faq', priority: 0.6 },
  { es: '/contacto', en: '/en/contact', priority: 0.6 },
  { es: '/terminos', en: '/en/terms', priority: 0.3 },
  { es: '/privacidad', en: '/en/privacy', priority: 0.3 },
  { es: '/politica-cookies', en: '/en/cookie-policy', priority: 0.3 },
];

export default function sitemap(): MetadataRoute.Sitemap {
  return ROUTES.map(({ es, en, priority }) => ({
    url: `${SITE_URL}${es}`,
    changeFrequency: 'weekly',
    priority,
    alternates: {
      languages: {
        es: `${SITE_URL}${es}`,
        en: `${SITE_URL}${en}`,
      },
    },
  }));
}
