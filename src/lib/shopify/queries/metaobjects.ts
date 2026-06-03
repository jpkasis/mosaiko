/**
 * Shopify Metaobject queries used by the admin-editable site-copy CMS.
 *
 * Architecture: per-page singleton Metaobjects. PR2 only consumes
 * `mosaiko_home_copy/singleton`. PR3 will add a Contenido editor that
 * writes back via `metaobjectUpdate` + `translationsRegister`.
 *
 * Locale handling: the metaobject's BASE field values are Spanish
 * (default locale). English values are written into Shopify's
 * Translations API as `translatableResource(id).translations(locale:"en")`.
 * Pulling them out requires a separate query (see HOME_COPY_TRANSLATIONS_QUERY).
 *
 * Docs:
 *   https://shopify.dev/docs/api/admin-graphql/latest/queries/metaobjectByHandle
 *   https://shopify.dev/docs/api/admin-graphql/latest/queries/translatableResource
 */
import { shopifyAdminFetch } from '@/lib/shopify/client';

export interface MetaobjectField {
  key: string;
  value: string | null;
}

export interface HomeCopyMetaobject {
  id: string;
  handle: string;
  fields: MetaobjectField[];
}

export interface TranslationEntry {
  key: string;
  value: string | null;
  outdated: boolean;
}

export const HOME_COPY_METAOBJECT_QUERY = /* GraphQL */ `
  query HomeCopyMetaobject {
    metaobjectByHandle(handle: { type: "mosaiko_home_copy", handle: "singleton" }) {
      id
      handle
      fields {
        key
        value
      }
    }
  }
`;

export const HOME_COPY_TRANSLATIONS_QUERY = /* GraphQL */ `
  query HomeCopyTranslations($resourceId: ID!, $locale: String!) {
    translatableResource(resourceId: $resourceId) {
      resourceId
      translations(locale: $locale) {
        key
        value
        outdated
      }
    }
  }
`;

/**
 * Translatable-content digests. PR3 admin save path requires these for
 * `translationsRegister` — Shopify rejects translation writes without a
 * fresh per-field digest. Digests change when the base (es) content
 * changes, so the admin route must fetch them AFTER any `metaobjectUpdate`
 * call within the same request.
 *
 * Docs: https://shopify.dev/docs/api/admin-graphql/latest/queries/translatableresource
 */
export const TRANSLATABLE_RESOURCE_CONTENT_QUERY = /* GraphQL */ `
  query TranslatableResourceContent($resourceId: ID!) {
    translatableResource(resourceId: $resourceId) {
      resourceId
      translatableContent {
        key
        value
        digest
        locale
      }
    }
  }
`;

interface HomeCopyMetaobjectResponse {
  metaobjectByHandle: HomeCopyMetaobject | null;
}

interface HomeCopyTranslationsResponse {
  translatableResource: {
    resourceId: string;
    translations: TranslationEntry[];
  } | null;
}

export interface TranslatableContentEntry {
  key: string;
  value: string | null;
  digest: string;
  locale: string;
}

interface TranslatableContentResponse {
  translatableResource: {
    resourceId: string;
    translatableContent: TranslatableContentEntry[];
  } | null;
}

/**
 * Fetches the base (Spanish) home-copy metaobject. Returns `null` when
 * the metaobject hasn't been seeded yet, or when the entry was deleted
 * from Shopify Admin. Throws on Shopify errors (auth, network, GraphQL).
 */
export async function getHomeCopyMetaobject(): Promise<HomeCopyMetaobject | null> {
  const data = await shopifyAdminFetch<HomeCopyMetaobjectResponse>({
    query: HOME_COPY_METAOBJECT_QUERY,
    options: { cache: 'no-store' },
  });
  return data.metaobjectByHandle ?? null;
}

// ─── Business settings (UAT-6 PR4) ──────────────────────────────────────────

export const BUSINESS_SETTINGS_METAOBJECT_QUERY = /* GraphQL */ `
  query BusinessSettingsMetaobject {
    metaobjectByHandle(handle: { type: "mosaiko_business_settings", handle: "singleton" }) {
      id
      handle
      fields {
        key
        value
      }
    }
  }
`;

interface BusinessSettingsMetaobjectResponse {
  metaobjectByHandle: HomeCopyMetaobject | null;
}

/**
 * Fetches the business-settings metaobject (singleton). Same shape as
 * home-copy: id + handle + fields[]. Returns `null` when not seeded.
 * The translation + digest helpers below are generic by resourceId, so
 * PR4 reuses them for EN business_name/footer_copy.
 */
export async function getBusinessSettingsMetaobject(): Promise<HomeCopyMetaobject | null> {
  const data = await shopifyAdminFetch<BusinessSettingsMetaobjectResponse>({
    query: BUSINESS_SETTINGS_METAOBJECT_QUERY,
    options: { cache: 'no-store' },
  });
  return data.metaobjectByHandle ?? null;
}

/**
 * Fetches the English translations for a given metaobject resource id.
 * Returns an empty array when no translations have been registered yet.
 */
export async function getHomeCopyTranslations(
  resourceId: string,
  locale: string,
): Promise<TranslationEntry[]> {
  const data = await shopifyAdminFetch<HomeCopyTranslationsResponse>({
    query: HOME_COPY_TRANSLATIONS_QUERY,
    variables: { resourceId, locale },
    options: { cache: 'no-store' },
  });
  return data.translatableResource?.translations ?? [];
}

/**
 * Returns a `{ fieldKey: digest }` map for the given resource. Used by the
 * PR3 admin save path to feed `translationsRegister` (Shopify requires a
 * fresh digest per translation input).
 *
 * MUST be called AFTER any `metaobjectUpdate` for the same resource — base
 * content changes invalidate previous digests.
 */
export async function getTranslatableContentDigests(
  resourceId: string,
): Promise<Record<string, string>> {
  const data = await shopifyAdminFetch<TranslatableContentResponse>({
    query: TRANSLATABLE_RESOURCE_CONTENT_QUERY,
    variables: { resourceId },
    options: { cache: 'no-store' },
  });
  const entries = data.translatableResource?.translatableContent ?? [];
  const out: Record<string, string> = {};
  for (const e of entries) out[e.key] = e.digest;
  return out;
}
