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

interface HomeCopyMetaobjectResponse {
  metaobjectByHandle: HomeCopyMetaobject | null;
}

interface HomeCopyTranslationsResponse {
  translatableResource: {
    resourceId: string;
    translations: TranslationEntry[];
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
