/**
 * Shopify Metaobject + Translation write helpers used by the admin
 * Configuración → Contenido save path (UAT-6 PR3).
 *
 * Two paired mutations:
 *   1. `metaobjectUpdate` — writes base (Spanish) field values
 *   2. `translationsRegister` — writes per-locale translations (EN)
 *
 * Translations require a `translatableContentDigest` per field. Digests
 * are obtained via `getTranslatableContentDigests` AFTER the base update
 * (digest changes when base value changes). The admin route serializes
 * these calls; this module exposes pure GraphQL wrappers and does not
 * enforce ordering.
 *
 * Docs:
 *   https://shopify.dev/docs/api/admin-graphql/latest/mutations/metaobjectUpdate
 *   https://shopify.dev/docs/api/admin-graphql/latest/mutations/translationsregister
 */
import { shopifyAdminFetch } from '@/lib/shopify/client';

export interface ShopifyUserError {
  field?: string[] | null;
  message: string;
  code?: string | null;
  elementIndex?: number | null;
  elementKey?: string | null;
}

/**
 * Thrown when Shopify returns `userErrors` from a mutation. The API
 * route catches this and surfaces a 502 with the original messages.
 */
export class ShopifyUserErrorsError extends Error {
  readonly userErrors: ShopifyUserError[];
  constructor(operation: string, userErrors: ShopifyUserError[]) {
    super(
      `${operation} returned userErrors: ${userErrors
        .map((e) => `${e.field?.join('.') ?? '<top>'}: ${e.message}`)
        .join('; ')}`,
    );
    this.name = 'ShopifyUserErrorsError';
    this.userErrors = userErrors;
  }
}

// ─── metaobjectUpdate ───────────────────────────────────────────────────────

export const METAOBJECT_UPDATE_MUTATION = /* GraphQL */ `
  mutation MetaobjectUpdate($id: ID!, $metaobject: MetaobjectUpdateInput!) {
    metaobjectUpdate(id: $id, metaobject: $metaobject) {
      metaobject {
        id
        type
        handle
        fields {
          key
          value
        }
      }
      userErrors {
        field
        message
        code
        elementIndex
        elementKey
      }
    }
  }
`;

interface MetaobjectUpdateResponse {
  metaobjectUpdate: {
    metaobject: {
      id: string;
      type: string;
      handle: string;
      fields: Array<{ key: string; value: string | null }>;
    } | null;
    userErrors: ShopifyUserError[];
  };
}

/**
 * Writes (or clears) base (Spanish) field values on a Mosaiko metaobject.
 * `fields` is a list of `{ key, value }` — empty-string values are valid
 * and explicitly clear the field. Returns the resulting `metaobject`
 * snapshot. Throws `ShopifyUserErrorsError` if Shopify rejects.
 */
export async function updateMetaobjectFields(
  id: string,
  fields: Array<{ key: string; value: string }>,
): Promise<{ id: string; fields: Array<{ key: string; value: string | null }> }> {
  const data = await shopifyAdminFetch<MetaobjectUpdateResponse>({
    query: METAOBJECT_UPDATE_MUTATION,
    variables: { id, metaobject: { fields } },
    options: { cache: 'no-store' },
  });
  const result = data.metaobjectUpdate;
  if (result.userErrors.length > 0) {
    throw new ShopifyUserErrorsError('metaobjectUpdate', result.userErrors);
  }
  if (!result.metaobject) {
    throw new Error('metaobjectUpdate returned null metaobject without userErrors');
  }
  return { id: result.metaobject.id, fields: result.metaobject.fields };
}

// ─── translationsRegister ───────────────────────────────────────────────────

export const TRANSLATIONS_REGISTER_MUTATION = /* GraphQL */ `
  mutation TranslationsRegister(
    $resourceId: ID!
    $translations: [TranslationInput!]!
  ) {
    translationsRegister(resourceId: $resourceId, translations: $translations) {
      translations {
        key
        value
        locale
      }
      userErrors {
        field
        message
      }
    }
  }
`;

interface TranslationsRegisterResponse {
  translationsRegister: {
    translations: Array<{ key: string; value: string | null; locale: string }>;
    userErrors: ShopifyUserError[];
  };
}

export interface TranslationInput {
  key: string;
  value: string;
  translatableContentDigest: string;
}

/**
 * Registers per-locale translations for a metaobject (or any
 * translatable resource). Each input requires a fresh digest from
 * `getTranslatableContentDigests(resourceId)`, which must be called
 * AFTER any base-content writes within the same logical request.
 *
 * Throws `ShopifyUserErrorsError` on any rejection.
 */
export async function registerTranslations(
  resourceId: string,
  locale: 'en',
  translations: TranslationInput[],
): Promise<void> {
  // Shopify TranslationInput shape per docs:
  //   { key, value, locale, translatableContentDigest }
  const inputs = translations.map((t) => ({
    locale,
    key: t.key,
    value: t.value,
    translatableContentDigest: t.translatableContentDigest,
  }));
  const data = await shopifyAdminFetch<TranslationsRegisterResponse>({
    query: TRANSLATIONS_REGISTER_MUTATION,
    variables: { resourceId, translations: inputs },
    options: { cache: 'no-store' },
  });
  const result = data.translationsRegister;
  if (result.userErrors.length > 0) {
    throw new ShopifyUserErrorsError('translationsRegister', result.userErrors);
  }
}
