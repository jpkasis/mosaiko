/**
 * UAT-6 PR3 contract test: Shopify metaobject + translation mutations.
 *
 *   - updateMetaobjectFields: posts MetaobjectUpdate with the right input
 *   - throws ShopifyUserErrorsError on userErrors
 *   - registerTranslations: posts TranslationsRegister with locale + digest
 *   - throws ShopifyUserErrorsError on userErrors
 */
import { describe, test, expect, vi, beforeEach } from 'vitest';

const mockAdminFetch = vi.fn();
vi.mock('@/lib/shopify/client', () => ({
  shopifyAdminFetch: (args: unknown) => mockAdminFetch(args),
}));

beforeEach(() => {
  mockAdminFetch.mockReset();
});

describe('updateMetaobjectFields', () => {
  test('posts MetaobjectUpdate with id + fields', async () => {
    mockAdminFetch.mockResolvedValue({
      metaobjectUpdate: {
        metaobject: {
          id: 'gid://shopify/Metaobject/1',
          type: 'mosaiko_home_copy',
          handle: 'singleton',
          fields: [{ key: 'hero_title', value: 'Updated' }],
        },
        userErrors: [],
      },
    });
    const { updateMetaobjectFields } = await import(
      '@/lib/shopify/mutations/metaobjects'
    );
    const result = await updateMetaobjectFields(
      'gid://shopify/Metaobject/1',
      [{ key: 'hero_title', value: 'Updated' }],
    );
    expect(result.id).toBe('gid://shopify/Metaobject/1');
    expect(result.fields).toEqual([{ key: 'hero_title', value: 'Updated' }]);
    expect(mockAdminFetch).toHaveBeenCalledTimes(1);
    const call = mockAdminFetch.mock.calls[0][0] as {
      query: string;
      variables: Record<string, unknown>;
    };
    expect(call.query).toContain('metaobjectUpdate');
    expect(call.variables).toMatchObject({
      id: 'gid://shopify/Metaobject/1',
      metaobject: { fields: [{ key: 'hero_title', value: 'Updated' }] },
    });
  });

  test('throws ShopifyUserErrorsError on userErrors', async () => {
    mockAdminFetch.mockResolvedValue({
      metaobjectUpdate: {
        metaobject: null,
        userErrors: [
          { field: ['fields', '0', 'value'], message: 'too long', code: 'TOO_LONG' },
        ],
      },
    });
    const { updateMetaobjectFields, ShopifyUserErrorsError } = await import(
      '@/lib/shopify/mutations/metaobjects'
    );
    await expect(
      updateMetaobjectFields('id', [{ key: 'x', value: 'y' }]),
    ).rejects.toBeInstanceOf(ShopifyUserErrorsError);
  });
});

describe('registerTranslations', () => {
  test('posts TranslationsRegister with locale + digest', async () => {
    mockAdminFetch.mockResolvedValue({
      translationsRegister: {
        translations: [
          { key: 'hero_title', value: 'Your title', locale: 'en' },
        ],
        userErrors: [],
      },
    });
    const { registerTranslations } = await import(
      '@/lib/shopify/mutations/metaobjects'
    );
    await registerTranslations('resource-id', 'en', [
      {
        key: 'hero_title',
        value: 'Your title',
        translatableContentDigest: 'digest-1',
      },
    ]);
    expect(mockAdminFetch).toHaveBeenCalledTimes(1);
    const call = mockAdminFetch.mock.calls[0][0] as {
      query: string;
      variables: Record<string, unknown>;
    };
    expect(call.query).toContain('translationsRegister');
    expect(call.variables).toMatchObject({
      resourceId: 'resource-id',
      translations: [
        {
          locale: 'en',
          key: 'hero_title',
          value: 'Your title',
          translatableContentDigest: 'digest-1',
        },
      ],
    });
  });

  test('throws ShopifyUserErrorsError on userErrors', async () => {
    mockAdminFetch.mockResolvedValue({
      translationsRegister: {
        translations: [],
        userErrors: [{ message: 'invalid digest' }],
      },
    });
    const { registerTranslations, ShopifyUserErrorsError } = await import(
      '@/lib/shopify/mutations/metaobjects'
    );
    await expect(
      registerTranslations('rid', 'en', [
        { key: 'k', value: 'v', translatableContentDigest: 'stale' },
      ]),
    ).rejects.toBeInstanceOf(ShopifyUserErrorsError);
  });
});
