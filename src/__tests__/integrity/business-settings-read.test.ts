/**
 * UAT-6 PR4 contract test: public business-settings read layer.
 *
 * Maps metaobject fields to the public camelCase shape, resolves localized
 * fields per-locale (EN from translations), and NEVER exposes
 * notification_email.
 */
import { describe, test, expect, vi, beforeEach } from 'vitest';

const mockGetBusinessMeta = vi.fn();
const mockGetTranslations = vi.fn();
vi.mock('@/lib/shopify/queries/metaobjects', () => ({
  getBusinessSettingsMetaobject: () => mockGetBusinessMeta(),
  getHomeCopyMetaobject: vi.fn(),
  getHomeCopyTranslations: (id: string, locale: string) =>
    mockGetTranslations(id, locale),
}));

vi.mock('next/cache', () => ({
  unstable_cache: <Args extends unknown[], R>(fn: (...args: Args) => Promise<R>) => fn,
}));

beforeEach(() => {
  mockGetBusinessMeta.mockReset();
  mockGetTranslations.mockReset();
  vi.resetModules();
  delete process.env.SHOPIFY_ADMIN_API_TOKEN;
  delete process.env.SHOPIFY_CLIENT_ID;
  delete process.env.SHOPIFY_CLIENT_SECRET;
});

function withShopify() {
  process.env.SHOPIFY_ADMIN_API_TOKEN = 'shpat_test';
}

const FULL_FIELDS = [
  { key: 'business_name', value: 'Mosaiko' },
  { key: 'footer_copy', value: 'Pie ES' },
  { key: 'address', value: 'CDMX' },
  { key: 'phone', value: '555' },
  { key: 'whatsapp', value: '+5215512345678' },
  { key: 'instagram_url', value: 'https://instagram.com/m' },
  { key: 'facebook_url', value: 'https://facebook.com/m' },
  { key: 'image_retention_days', value: '90' },
  { key: 'notification_email', value: 'secret@b.com' },
];

describe('getBusinessSettings', () => {
  test('creds unset → all-empty public shape', async () => {
    const { getBusinessSettings } = await import('@/lib/site-content');
    const r = await getBusinessSettings('es');
    expect(r.businessName).toBe('');
    expect(mockGetBusinessMeta).not.toHaveBeenCalled();
  });

  test('es: maps base fields to public camelCase, omits notificationEmail', async () => {
    withShopify();
    mockGetBusinessMeta.mockResolvedValue({ id: 'gid://1', fields: FULL_FIELDS });
    const { getBusinessSettings } = await import('@/lib/site-content');
    const r = await getBusinessSettings('es');
    expect(r).toEqual({
      businessName: 'Mosaiko',
      footerCopy: 'Pie ES',
      address: 'CDMX',
      phone: '555',
      whatsapp: '+5215512345678',
      whatsappMessage: '',
      instagramUrl: 'https://instagram.com/m',
      facebookUrl: 'https://facebook.com/m',
      tiktokUrl: '',
    });
    // notificationEmail MUST NOT be present on the public shape
    expect('notificationEmail' in r).toBe(false);
    expect(JSON.stringify(r)).not.toContain('secret@b.com');
  });

  test('es: whatsapp_message maps to the public whatsappMessage prop', async () => {
    withShopify();
    mockGetBusinessMeta.mockResolvedValue({
      id: 'gid://1',
      fields: [...FULL_FIELDS, { key: 'whatsapp_message', value: 'Hola desde Mosaiko' }],
    });
    const { getBusinessSettings } = await import('@/lib/site-content');
    const r = await getBusinessSettings('es');
    expect(r.whatsappMessage).toBe('Hola desde Mosaiko');
  });

  test('en: localized fields use translations; neutral fields stay base', async () => {
    withShopify();
    mockGetBusinessMeta.mockResolvedValue({ id: 'gid://1', fields: FULL_FIELDS });
    mockGetTranslations.mockResolvedValue([
      { key: 'business_name', value: 'Mosaiko EN', outdated: false },
      { key: 'footer_copy', value: 'Footer EN', outdated: false },
    ]);
    const { getBusinessSettings } = await import('@/lib/site-content');
    const r = await getBusinessSettings('en');
    expect(r.businessName).toBe('Mosaiko EN');
    expect(r.footerCopy).toBe('Footer EN');
    // neutral fields unchanged
    expect(r.phone).toBe('555');
    expect(r.address).toBe('CDMX');
  });

  test('en: missing translation falls back to ES base for localized field', async () => {
    withShopify();
    mockGetBusinessMeta.mockResolvedValue({ id: 'gid://1', fields: FULL_FIELDS });
    mockGetTranslations.mockResolvedValue([]); // no EN translations
    const { getBusinessSettings } = await import('@/lib/site-content');
    const r = await getBusinessSettings('en');
    expect(r.businessName).toBe('Mosaiko'); // ES base fallback
  });

  test('metaobject null → all-empty', async () => {
    withShopify();
    mockGetBusinessMeta.mockResolvedValue(null);
    const { getBusinessSettings } = await import('@/lib/site-content');
    const r = await getBusinessSettings('es');
    expect(r.businessName).toBe('');
  });

  test('Shopify error → graceful all-empty (never throws)', async () => {
    withShopify();
    mockGetBusinessMeta.mockRejectedValue(new Error('shopify down'));
    const { getBusinessSettings } = await import('@/lib/site-content');
    const r = await getBusinessSettings('es');
    expect(r.businessName).toBe('');
    expect(r.phone).toBe('');
  });
});

describe('getImageRetentionDays', () => {
  test('creds unset → default 45 without fetching Shopify', async () => {
    const { getImageRetentionDays } = await import('@/lib/site-content');
    const r = await getImageRetentionDays();
    expect(r).toBe(45);
    expect(mockGetBusinessMeta).not.toHaveBeenCalled();
  });

  test('reads valid image_retention_days from business settings', async () => {
    withShopify();
    mockGetBusinessMeta.mockResolvedValue({
      id: 'gid://1',
      fields: [{ key: 'image_retention_days', value: '120' }],
    });
    const { getImageRetentionDays } = await import('@/lib/site-content');
    await expect(getImageRetentionDays()).resolves.toBe(120);
  });

  test('allows 0 as the disabled kill-switch', async () => {
    withShopify();
    mockGetBusinessMeta.mockResolvedValue({
      id: 'gid://1',
      fields: [{ key: 'image_retention_days', value: '0' }],
    });
    const { getImageRetentionDays } = await import('@/lib/site-content');
    await expect(getImageRetentionDays()).resolves.toBe(0);
  });

  test.each(['abc', '1.5', '-1', '', null])(
    'invalid image_retention_days %s → default 45',
    async (value) => {
      withShopify();
      mockGetBusinessMeta.mockResolvedValue({
        id: 'gid://1',
        fields: [{ key: 'image_retention_days', value }],
      });
      const { getImageRetentionDays } = await import('@/lib/site-content');
      await expect(getImageRetentionDays()).resolves.toBe(45);
    },
  );

  test('Shopify error → default 45', async () => {
    withShopify();
    mockGetBusinessMeta.mockRejectedValue(new Error('shopify down'));
    const { getImageRetentionDays } = await import('@/lib/site-content');
    await expect(getImageRetentionDays()).resolves.toBe(45);
  });
});
