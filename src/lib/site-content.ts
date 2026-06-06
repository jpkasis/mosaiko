/**
 * Site-content CMS read layer (UAT-6 PR2).
 *
 * Resolves admin-editable copy from Shopify Metaobjects with graceful
 * fallback to static next-intl JSON when:
 *   - Shopify credentials are missing (local dev without admin creds)
 *   - Metaobject hasn't been seeded yet
 *   - A specific field is empty / not yet filled in by the admin
 *   - Shopify Admin API is unreachable (network / outage)
 *
 * Architecture: server-side only. Called from `src/i18n/request.ts` so
 * the override flows through next-intl's `NextIntlClientProvider` to
 * every `useTranslations()` consumer. Cached via `unstable_cache` with
 * tag-based invalidation — PR3's admin save handler calls
 * `revalidateTag(SITE_COPY_TAG)` after writing the metaobject.
 *
 * No client refactor required: existing client components keep calling
 * `useTranslations('hero')` and friends, unaware that the message map
 * was merged with Shopify content at the request boundary.
 */
import { unstable_cache } from 'next/cache';
import {
  getHomeCopyMetaobject,
  getHomeCopyTranslations,
  getBusinessSettingsMetaobject,
  type MetaobjectField,
  type TranslationEntry,
} from '@/lib/shopify/queries/metaobjects';

export const SITE_COPY_TAG = 'site-copy';
export const SITE_COPY_HOME_TAG = 'site-copy:home';
export const SITE_COPY_BUSINESS_TAG = 'site-copy:business';
export const SITE_COPY_REVALIDATE_S = 60 * 60; // 1h soft TTL; admin save bypasses via revalidateTag

export type SupportedLocale = 'es' | 'en';
export const DEFAULT_LOCALE: SupportedLocale = 'es';

/**
 * Path map: next-intl message path → Shopify Metaobject field key.
 *
 * Only keys that ALREADY exist in `src/messages/{es,en}.json` are mapped.
 * PR3/4 can extend this map as more page sections become admin-editable.
 *
 * Step-level keys (step1Title, step1Desc, etc.) are intentionally NOT
 * mapped in PR2 — only the section-level titles. Keeping the surface
 * narrow lets the admin client touch a handful of fields without
 * overwhelming the editor UI in PR3.
 */
export const HOME_COPY_MAP = {
  'hero.badge': 'hero_badge',
  'hero.title': 'hero_title',
  'hero.subtitle': 'hero_subtitle',
  'hero.cta': 'hero_cta',
  'hero.ctaSecondary': 'hero_cta_secondary',
  'howItWorks.title': 'how_it_works_title',
  'howItWorks.subtitle': 'how_it_works_subtitle',
} as const;

type CopyPath = keyof typeof HOME_COPY_MAP;

// ─── Shopify creds gate ─────────────────────────────────────────────────────

function shopifyAdminAvailable(): boolean {
  return Boolean(
    process.env.SHOPIFY_ADMIN_API_TOKEN ||
      (process.env.SHOPIFY_CLIENT_ID && process.env.SHOPIFY_CLIENT_SECRET),
  );
}

// ─── Field-value helpers ────────────────────────────────────────────────────

function fieldsToMap(
  fields: ReadonlyArray<MetaobjectField | TranslationEntry>,
): Map<string, string> {
  const out = new Map<string, string>();
  for (const f of fields) {
    if (typeof f.value !== 'string') continue;
    const trimmed = f.value.trim();
    if (trimmed.length === 0) continue; // empty/whitespace → treat as missing
    out.set(f.key, trimmed);
  }
  return out;
}

function setNestedKey(target: Record<string, unknown>, path: string, value: string): void {
  const segments = path.split('.');
  let cursor: Record<string, unknown> = target;
  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i];
    const next = cursor[seg];
    if (typeof next === 'object' && next !== null && !Array.isArray(next)) {
      cursor = next as Record<string, unknown>;
    } else {
      const fresh: Record<string, unknown> = {};
      cursor[seg] = fresh;
      cursor = fresh;
    }
  }
  cursor[segments[segments.length - 1]] = value;
}

// ─── Core uncached implementation ───────────────────────────────────────────
//
// IMPORTANT: this function lets Shopify fetch errors PROPAGATE. The outer
// `getSiteCopyOverrides` catches them so the caller still receives `{}`.
// `unstable_cache` does not cache thrown errors — letting them bubble keeps
// transient outages from being frozen in the cache for SITE_COPY_REVALIDATE_S.
// Legitimate empty states (no creds, no metaobject, no translations) ARE
// returned normally and so ARE cached, which is intended.

async function buildOverridesUncached(
  locale: SupportedLocale,
): Promise<Record<string, unknown>> {
  if (!shopifyAdminAvailable()) return {};

  const metaobject = await getHomeCopyMetaobject();
  if (!metaobject) return {};

  // Source the right field map per locale.
  let fieldMap: Map<string, string>;
  if (locale === DEFAULT_LOCALE) {
    fieldMap = fieldsToMap(metaobject.fields);
  } else {
    const translations = await getHomeCopyTranslations(metaobject.id, locale);
    fieldMap = fieldsToMap(translations);
  }

  const overrides: Record<string, unknown> = {};
  for (const [path, fieldKey] of Object.entries(HOME_COPY_MAP)) {
    const v = fieldMap.get(fieldKey);
    if (v === undefined) continue; // missing or empty → fall back to static JSON
    setNestedKey(overrides, path, v);
  }
  return overrides;
}

// ─── Cached wrapper ─────────────────────────────────────────────────────────

const fetchOverridesCached = unstable_cache(
  async (locale: SupportedLocale) => buildOverridesUncached(locale),
  ['site-content', 'home-copy'],
  {
    tags: [SITE_COPY_TAG, SITE_COPY_HOME_TAG],
    revalidate: SITE_COPY_REVALIDATE_S,
  },
);

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Returns a partial next-intl message tree of Shopify-sourced overrides
 * for the given locale. Shape mirrors the static JSON (`{ hero: {...},
 * howItWorks: {...} }`). Empty `{}` when no overrides apply.
 *
 * Cached for SITE_COPY_REVALIDATE_S; tagged with SITE_COPY_TAG +
 * SITE_COPY_HOME_TAG. PR3's admin save calls `revalidateTag(SITE_COPY_TAG)`.
 *
 * Transient Shopify errors (network, auth, 5xx) are caught here so a
 * single bad request doesn't poison the cache for an hour — the caller
 * sees `{}` (graceful degradation to static JSON) and the next request
 * retries fresh.
 */
export async function getSiteCopyOverrides(
  locale: SupportedLocale,
): Promise<Record<string, unknown>> {
  try {
    return await fetchOverridesCached(locale);
  } catch (error) {
    console.warn('[site-content] fetch failed:', error);
    return {};
  }
}

/**
 * Per-key convenience for future page migrations. Resolves Shopify's
 * value when present; otherwise returns the caller-provided fallback
 * (which the caller should source from `useTranslations` / `getTranslations`).
 *
 * NOTE: PR2's primary consumer is `request.ts` via `getSiteCopyOverrides`.
 * `getCopy` is provided for one-off RSC reads that don't go through
 * next-intl (e.g. an `<og:title>` builder).
 */
export async function getCopy(
  locale: SupportedLocale,
  path: string,
  fallback: string,
): Promise<string> {
  if (!(path in HOME_COPY_MAP)) return fallback;
  const overrides = await getSiteCopyOverrides(locale);
  const segments = path.split('.');
  let cursor: unknown = overrides;
  for (const seg of segments) {
    if (typeof cursor !== 'object' || cursor === null) return fallback;
    cursor = (cursor as Record<string, unknown>)[seg];
  }
  if (typeof cursor !== 'string') return fallback;
  return cursor;
}

// Re-exports for tests + PR3
export type { CopyPath };

// ─── Business settings (UAT-6 PR4) ──────────────────────────────────────────
//
// The `mosaiko_business_settings` metaobject holds the client's contact +
// social + identity info. Two fields are localized (business_name,
// footer_copy); the rest are locale-neutral. `notification_email` is
// admin-only and MUST NOT appear in the public read shape.

/** Metaobject field key → public camelCase property. Localized flag drives
 *  whether the EN value comes from translations vs the ES base. */
export const BUSINESS_SETTINGS_MAP = {
  business_name: { prop: 'businessName', localized: true },
  footer_copy: { prop: 'footerCopy', localized: true },
  address: { prop: 'address', localized: false },
  phone: { prop: 'phone', localized: false },
  whatsapp: { prop: 'whatsapp', localized: false },
  whatsapp_message: { prop: 'whatsappMessage', localized: false },
  instagram_url: { prop: 'instagramUrl', localized: false },
  facebook_url: { prop: 'facebookUrl', localized: false },
} as const;

/** Admin-only field — never returned in the PUBLIC shape. */
export const BUSINESS_NOTIFICATION_EMAIL_KEY = 'notification_email';

/** Public business settings consumed by Footer + Contact (no notificationEmail). */
export interface PublicBusinessSettings {
  businessName: string;
  footerCopy: string;
  address: string;
  phone: string;
  whatsapp: string;
  whatsappMessage: string;
  instagramUrl: string;
  facebookUrl: string;
}

const EMPTY_PUBLIC_SETTINGS: PublicBusinessSettings = {
  businessName: '',
  footerCopy: '',
  address: '',
  phone: '',
  whatsapp: '',
  whatsappMessage: '',
  instagramUrl: '',
  facebookUrl: '',
};

async function buildBusinessSettingsUncached(
  locale: SupportedLocale,
): Promise<PublicBusinessSettings> {
  if (!shopifyAdminAvailable()) return EMPTY_PUBLIC_SETTINGS;

  const metaobject = await getBusinessSettingsMetaobject();
  if (!metaobject) return EMPTY_PUBLIC_SETTINGS;

  const baseMap = fieldsToMap(metaobject.fields);
  // EN translations only needed for localized fields when locale !== es.
  let translationMap: Map<string, string> | null = null;
  if (locale !== DEFAULT_LOCALE) {
    const translations = await getHomeCopyTranslations(metaobject.id, locale);
    translationMap = fieldsToMap(translations);
  }

  const out: PublicBusinessSettings = { ...EMPTY_PUBLIC_SETTINGS };
  for (const [fieldKey, { prop, localized }] of Object.entries(BUSINESS_SETTINGS_MAP)) {
    let value: string | undefined;
    if (localized && translationMap) {
      // EN: prefer translation, fall back to ES base (business identity
      // should still show *something* if EN translation is blank).
      value = translationMap.get(fieldKey) ?? baseMap.get(fieldKey);
    } else {
      value = baseMap.get(fieldKey);
    }
    if (value !== undefined) {
      (out as unknown as Record<string, string>)[prop] = value;
    }
  }
  return out;
}

const fetchBusinessSettingsCached = unstable_cache(
  async (locale: SupportedLocale) => buildBusinessSettingsUncached(locale),
  ['site-content', 'business-settings'],
  {
    tags: [SITE_COPY_TAG, SITE_COPY_BUSINESS_TAG],
    revalidate: SITE_COPY_REVALIDATE_S,
  },
);

/**
 * Public business settings for the given locale, consumed by Footer +
 * Contact. Localized fields (businessName, footerCopy) resolve per-locale;
 * neutral fields are returned as-is. `notification_email` is intentionally
 * omitted. On Shopify error → all-empty object (callers conditionally
 * render each field).
 */
export async function getBusinessSettings(
  locale: SupportedLocale,
): Promise<PublicBusinessSettings> {
  try {
    return await fetchBusinessSettingsCached(locale);
  } catch (error) {
    console.warn('[site-content] business settings fetch failed:', error);
    return EMPTY_PUBLIC_SETTINGS;
  }
}
