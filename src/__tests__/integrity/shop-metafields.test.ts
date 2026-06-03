/**
 * UAT-6 PR4 contract test: Shop-owner metafield write.
 */
import { describe, test, expect, vi, beforeEach } from 'vitest';

const mockAdminFetch = vi.fn();
vi.mock('@/lib/shopify/client', () => ({
  shopifyAdminFetch: (args: unknown) => mockAdminFetch(args),
}));

beforeEach(() => {
  mockAdminFetch.mockReset();
});

describe('setShopMetafield', () => {
  test('posts metafieldsSet with Shop ownerId + default type', async () => {
    mockAdminFetch.mockResolvedValue({
      metafieldsSet: {
        metafields: [{ id: 'gid://m/1', namespace: 'mosaiko_admin', key: 'password_hash' }],
        userErrors: [],
      },
    });
    const { setShopMetafield } = await import('@/lib/shopify/mutations/shop-metafields');
    await setShopMetafield(
      'gid://shopify/Shop/1',
      'mosaiko_admin',
      'password_hash',
      'hashvalue',
    );
    expect(mockAdminFetch).toHaveBeenCalledTimes(1);
    const call = mockAdminFetch.mock.calls[0][0] as {
      query: string;
      variables: Record<string, unknown>;
    };
    expect(call.query).toContain('metafieldsSet');
    expect(call.variables).toEqual({
      metafields: [
        {
          ownerId: 'gid://shopify/Shop/1',
          namespace: 'mosaiko_admin',
          key: 'password_hash',
          value: 'hashvalue',
          type: 'single_line_text_field',
        },
      ],
    });
  });

  test('throws ShopifyUserErrorsError on userErrors', async () => {
    mockAdminFetch.mockResolvedValue({
      metafieldsSet: {
        metafields: null,
        userErrors: [{ field: ['value'], message: 'invalid' }],
      },
    });
    const { setShopMetafield } = await import('@/lib/shopify/mutations/shop-metafields');
    const { ShopifyUserErrorsError } = await import('@/lib/shopify/mutations/metaobjects');
    await expect(
      setShopMetafield('gid://shopify/Shop/1', 'ns', 'k', 'v'),
    ).rejects.toBeInstanceOf(ShopifyUserErrorsError);
  });
});
