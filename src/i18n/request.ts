import { getRequestConfig } from 'next-intl/server';
import { routing } from './routing';
import { hasLocale } from 'next-intl';
import { deepMerge } from '@/lib/deep-merge';
import { getSiteCopyOverrides, type SupportedLocale } from '@/lib/site-content';

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = hasLocale(routing.locales, requested)
    ? requested
    : routing.defaultLocale;

  const staticMessages = (await import(`../messages/${locale}.json`)).default;

  // UAT-6 PR2: merge admin-editable Shopify Metaobject overrides on top of
  // the static JSON. Failures (creds missing, network down, metaobject not
  // yet seeded) degrade silently — the site MUST NOT fail rendering because
  // the CMS layer is unavailable.
  let overrides: Record<string, unknown> = {};
  try {
    overrides = await getSiteCopyOverrides(locale as SupportedLocale);
  } catch (error) {
    console.warn('[i18n/request] site-copy override failed:', error);
  }

  return {
    locale,
    messages: deepMerge(staticMessages, overrides),
  };
});
