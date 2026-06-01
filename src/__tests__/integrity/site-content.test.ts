/**
 * UAT-6 PR2 contract test: site-content CMS read layer.
 *
 * Locks the fallback chain that makes the static next-intl JSON the
 * always-safe baseline:
 *   - Shopify creds unset → no fetch, empty overrides, static wins
 *   - Metaobject not yet seeded → empty overrides
 *   - Field empty/whitespace → treat as missing (don't override with empty string)
 *   - Unknown field keys → ignored
 *   - English translation missing → omitted (en.json wins for that key)
 *   - Shopify throws → empty overrides (site never fails because CMS is down)
 *   - getCopy() returns Shopify value when present; fallback otherwise
 */
import { describe, test, expect, vi, beforeEach } from 'vitest';

const mockGetHomeCopyMetaobject = vi.fn();
const mockGetHomeCopyTranslations = vi.fn();

vi.mock('@/lib/shopify/queries/metaobjects', () => ({
  getHomeCopyMetaobject: (...args: unknown[]) => mockGetHomeCopyMetaobject(...args),
  getHomeCopyTranslations: (...args: unknown[]) => mockGetHomeCopyTranslations(...args),
}));

// next/cache's unstable_cache: pass-through wrapper (no real cache in tests)
vi.mock('next/cache', () => ({
  unstable_cache: <Args extends unknown[], R>(fn: (...args: Args) => Promise<R>) => fn,
}));

beforeEach(() => {
  mockGetHomeCopyMetaobject.mockReset();
  mockGetHomeCopyTranslations.mockReset();
  delete process.env.SHOPIFY_ADMIN_API_TOKEN;
  delete process.env.SHOPIFY_CLIENT_ID;
  delete process.env.SHOPIFY_CLIENT_SECRET;
  vi.resetModules();
});

function withShopifyCreds() {
  process.env.SHOPIFY_ADMIN_API_TOKEN = 'shpat_test-fixture';
}

describe('getSiteCopyOverrides', () => {
  test('Shopify creds unset → returns {}', async () => {
    const { getSiteCopyOverrides } = await import('@/lib/site-content');
    const result = await getSiteCopyOverrides('es');
    expect(result).toEqual({});
    expect(mockGetHomeCopyMetaobject).not.toHaveBeenCalled();
  });

  test('metaobjectByHandle returns null → returns {}', async () => {
    withShopifyCreds();
    mockGetHomeCopyMetaobject.mockResolvedValue(null);
    const { getSiteCopyOverrides } = await import('@/lib/site-content');
    const result = await getSiteCopyOverrides('es');
    expect(result).toEqual({});
  });

  test('Spanish base fields → nested next-intl shape', async () => {
    withShopifyCreds();
    mockGetHomeCopyMetaobject.mockResolvedValue({
      id: 'gid://shopify/Metaobject/1',
      handle: 'singleton',
      fields: [
        { key: 'hero_title', value: 'Tu foto, tu arte' },
        { key: 'hero_subtitle', value: 'Magnetiza tus recuerdos' },
        { key: 'how_it_works_title', value: 'Cómo funciona' },
      ],
    });
    const { getSiteCopyOverrides } = await import('@/lib/site-content');
    const result = await getSiteCopyOverrides('es');
    expect(result).toEqual({
      hero: {
        title: 'Tu foto, tu arte',
        subtitle: 'Magnetiza tus recuerdos',
      },
      howItWorks: {
        title: 'Cómo funciona',
      },
    });
  });

  test('English translations → mapped same nested shape', async () => {
    withShopifyCreds();
    mockGetHomeCopyMetaobject.mockResolvedValue({
      id: 'gid://shopify/Metaobject/1',
      handle: 'singleton',
      fields: [{ key: 'hero_title', value: 'es-base' }],
    });
    mockGetHomeCopyTranslations.mockResolvedValue([
      { key: 'hero_title', value: 'Your photo, your art', outdated: false },
      { key: 'hero_cta', value: 'Create now', outdated: false },
    ]);
    const { getSiteCopyOverrides } = await import('@/lib/site-content');
    const result = await getSiteCopyOverrides('en');
    expect(result).toEqual({
      hero: {
        title: 'Your photo, your art',
        cta: 'Create now',
      },
    });
    // English MUST NOT fall back to Spanish base — only en.json fallback at the
    // request boundary handles that.
    expect(result).not.toHaveProperty('hero.title', 'es-base');
  });

  test('English missing translation → omitted (no override)', async () => {
    withShopifyCreds();
    mockGetHomeCopyMetaobject.mockResolvedValue({
      id: 'gid://shopify/Metaobject/1',
      handle: 'singleton',
      fields: [{ key: 'hero_title', value: 'es-base' }],
    });
    mockGetHomeCopyTranslations.mockResolvedValue([]);
    const { getSiteCopyOverrides } = await import('@/lib/site-content');
    const result = await getSiteCopyOverrides('en');
    expect(result).toEqual({});
  });

  test('empty/whitespace field values → ignored', async () => {
    withShopifyCreds();
    mockGetHomeCopyMetaobject.mockResolvedValue({
      id: 'gid://shopify/Metaobject/1',
      handle: 'singleton',
      fields: [
        { key: 'hero_title', value: '' },
        { key: 'hero_subtitle', value: '   ' },
        { key: 'hero_cta', value: 'Real value' },
      ],
    });
    const { getSiteCopyOverrides } = await import('@/lib/site-content');
    const result = await getSiteCopyOverrides('es');
    expect(result).toEqual({ hero: { cta: 'Real value' } });
  });

  test('unknown field keys → ignored', async () => {
    withShopifyCreds();
    mockGetHomeCopyMetaobject.mockResolvedValue({
      id: 'gid://shopify/Metaobject/1',
      handle: 'singleton',
      fields: [
        { key: 'hero_title', value: 'Real' },
        { key: 'random_unknown_field', value: 'ignored' },
      ],
    });
    const { getSiteCopyOverrides } = await import('@/lib/site-content');
    const result = await getSiteCopyOverrides('es');
    expect(result).toEqual({ hero: { title: 'Real' } });
  });

  test('Shopify throws → returns {} (site never fails)', async () => {
    withShopifyCreds();
    mockGetHomeCopyMetaobject.mockRejectedValue(new Error('network down'));
    const { getSiteCopyOverrides } = await import('@/lib/site-content');
    const result = await getSiteCopyOverrides('es');
    expect(result).toEqual({});
  });
});

describe('getCopy', () => {
  test('returns Shopify value when present', async () => {
    withShopifyCreds();
    mockGetHomeCopyMetaobject.mockResolvedValue({
      id: 'gid://shopify/Metaobject/1',
      handle: 'singleton',
      fields: [{ key: 'hero_title', value: 'Shopify Title' }],
    });
    const { getCopy } = await import('@/lib/site-content');
    expect(await getCopy('es', 'hero.title', 'static fallback')).toBe('Shopify Title');
  });

  test('returns fallback when path not in HOME_COPY_MAP', async () => {
    withShopifyCreds();
    mockGetHomeCopyMetaobject.mockResolvedValue({
      id: 'gid://shopify/Metaobject/1',
      handle: 'singleton',
      fields: [],
    });
    const { getCopy } = await import('@/lib/site-content');
    expect(await getCopy('es', 'unknown.path', 'fallback-value')).toBe('fallback-value');
  });

  test('returns fallback when Shopify creds unset', async () => {
    const { getCopy } = await import('@/lib/site-content');
    expect(await getCopy('es', 'hero.title', 'static-default')).toBe('static-default');
  });

  test('returns fallback when Shopify value is empty', async () => {
    withShopifyCreds();
    mockGetHomeCopyMetaobject.mockResolvedValue({
      id: 'gid://shopify/Metaobject/1',
      handle: 'singleton',
      fields: [{ key: 'hero_title', value: '' }],
    });
    const { getCopy } = await import('@/lib/site-content');
    expect(await getCopy('es', 'hero.title', 'static-default')).toBe('static-default');
  });
});
