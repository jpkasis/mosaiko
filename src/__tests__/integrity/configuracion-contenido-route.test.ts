/**
 * UAT-6 PR3 contract test: /api/admin/configuracion/contenido GET + PUT.
 *
 * Locks the canonical save sequence:
 *   1. verifySession (auth)
 *   2. validateContenidoBody (schema)
 *   3. getHomeCopyMetaobject (resource id)
 *   4. updateMetaobjectFields (ES base)
 *   5. getTranslatableContentDigests (after step 4, before step 6)
 *   6. registerTranslations (EN)
 *   7. revalidateTag × 2 (SITE_COPY_TAG, SITE_COPY_HOME_TAG)
 */
import { describe, test, expect, vi, beforeEach } from 'vitest';

const mockVerifySession = vi.fn();
vi.mock('@/lib/admin/auth', () => ({
  verifySession: () => mockVerifySession(),
}));

const mockGetHomeCopyMetaobject = vi.fn();
const mockGetHomeCopyTranslations = vi.fn();
const mockGetTranslatableContentDigests = vi.fn();
vi.mock('@/lib/shopify/queries/metaobjects', () => ({
  getHomeCopyMetaobject: () => mockGetHomeCopyMetaobject(),
  getHomeCopyTranslations: (id: string, locale: string) =>
    mockGetHomeCopyTranslations(id, locale),
  getTranslatableContentDigests: (id: string) =>
    mockGetTranslatableContentDigests(id),
}));

const mockUpdateMetaobjectFields = vi.fn();
const mockRegisterTranslations = vi.fn();
const ShopifyUserErrorsError = class extends Error {
  userErrors: Array<{ field?: string[]; message: string }>;
  constructor(op: string, errs: Array<{ field?: string[]; message: string }>) {
    super(op);
    this.userErrors = errs;
  }
};
vi.mock('@/lib/shopify/mutations/metaobjects', () => ({
  updateMetaobjectFields: (id: string, fields: unknown) =>
    mockUpdateMetaobjectFields(id, fields),
  registerTranslations: (id: string, locale: string, translations: unknown) =>
    mockRegisterTranslations(id, locale, translations),
  ShopifyUserErrorsError,
}));

const mockRevalidateTag = vi.fn();
vi.mock('next/cache', () => ({
  revalidateTag: (tag: string, profile: unknown) =>
    mockRevalidateTag(tag, profile),
  // Pass-through unstable_cache so any transitive import of site-content
  // doesn't blow up on the missing export. We aren't exercising cache
  // behavior in this test — the read flow is mocked at the queries layer.
  unstable_cache: <Args extends unknown[], R>(
    fn: (...args: Args) => Promise<R>,
  ) => fn,
}));

beforeEach(() => {
  mockVerifySession.mockReset();
  mockGetHomeCopyMetaobject.mockReset();
  mockGetHomeCopyTranslations.mockReset();
  mockGetTranslatableContentDigests.mockReset();
  mockUpdateMetaobjectFields.mockReset();
  mockRegisterTranslations.mockReset();
  mockRevalidateTag.mockReset();
});

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/admin/configuracion/contenido', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('GET /api/admin/configuracion/contenido', () => {
  test('unauthenticated → 401', async () => {
    mockVerifySession.mockResolvedValue(false);
    const { GET } = await import(
      '@/app/api/admin/configuracion/contenido/route'
    );
    const res = await GET();
    expect(res.status).toBe(401);
  });

  test('happy path returns es + en map', async () => {
    mockVerifySession.mockResolvedValue(true);
    mockGetHomeCopyMetaobject.mockResolvedValue({
      id: 'gid://shopify/Metaobject/1',
      fields: [
        { key: 'hero_title', value: 'Tu foto' },
        { key: 'hero_subtitle', value: 'Subtítulo' },
      ],
    });
    mockGetHomeCopyTranslations.mockResolvedValue([
      { key: 'hero_title', value: 'Your photo', outdated: false },
    ]);
    const { GET } = await import(
      '@/app/api/admin/configuracion/contenido/route'
    );
    const res = await GET();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.content.es['hero.title']).toBe('Tu foto');
    expect(data.content.es['hero.subtitle']).toBe('Subtítulo');
    expect(data.content.en['hero.title']).toBe('Your photo');
    expect(data.translationStatus.en.available).toBe(true);
  });

  test('EN translation fetch failure returns ES with unavailable status', async () => {
    mockVerifySession.mockResolvedValue(true);
    mockGetHomeCopyMetaobject.mockResolvedValue({
      id: 'gid://shopify/Metaobject/1',
      fields: [{ key: 'hero_title', value: 'Tu foto' }],
    });
    mockGetHomeCopyTranslations.mockRejectedValue(
      new Error(
        '[Shopify Admin] GraphQL errors:\nAccess denied for translatableResource field. Required access: `read_translations` access scope.',
      ),
    );
    const { GET } = await import(
      '@/app/api/admin/configuracion/contenido/route'
    );
    const res = await GET();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.content.es['hero.title']).toBe('Tu foto');
    expect(data.content.en).toEqual({});
    expect(data.translationStatus.en.available).toBe(false);
    expect(data.translationStatus.en.message).toContain('read_translations');
  });

  test('metaobject missing → 404', async () => {
    mockVerifySession.mockResolvedValue(true);
    mockGetHomeCopyMetaobject.mockResolvedValue(null);
    const { GET } = await import(
      '@/app/api/admin/configuracion/contenido/route'
    );
    const res = await GET();
    expect(res.status).toBe(404);
  });
});

describe('PUT /api/admin/configuracion/contenido', () => {
  test('unauthenticated → 401', async () => {
    mockVerifySession.mockResolvedValue(false);
    const { PUT } = await import(
      '@/app/api/admin/configuracion/contenido/route'
    );
    const res = await PUT(makeRequest({ es: {}, en: {} }));
    expect(res.status).toBe(401);
  });

  test('unknown key → 400 with details', async () => {
    mockVerifySession.mockResolvedValue(true);
    const { PUT } = await import(
      '@/app/api/admin/configuracion/contenido/route'
    );
    const res = await PUT(makeRequest({ es: { 'hero.unknownKey': 'v' } }));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(Array.isArray(data.details)).toBe(true);
  });

  test('non-string value → 400', async () => {
    mockVerifySession.mockResolvedValue(true);
    const { PUT } = await import(
      '@/app/api/admin/configuracion/contenido/route'
    );
    const res = await PUT(makeRequest({ es: { 'hero.title': 123 } }));
    expect(res.status).toBe(400);
  });

  test('over-max length → 400', async () => {
    mockVerifySession.mockResolvedValue(true);
    const { PUT } = await import(
      '@/app/api/admin/configuracion/contenido/route'
    );
    const res = await PUT(
      makeRequest({ es: { 'hero.subtitle': 'x'.repeat(600) } }),
    );
    expect(res.status).toBe(400);
  });

  test('happy path calls sequence: getMeta → update → digests → register → revalidate×2', async () => {
    mockVerifySession.mockResolvedValue(true);
    mockGetHomeCopyMetaobject.mockResolvedValue({
      id: 'gid://shopify/Metaobject/1',
      fields: [],
    });
    mockUpdateMetaobjectFields.mockResolvedValue({
      id: 'gid://shopify/Metaobject/1',
      fields: [{ key: 'hero_title', value: 'Tu foto' }],
    });
    mockGetTranslatableContentDigests.mockResolvedValue({
      hero_title: 'digest-1',
    });
    mockRegisterTranslations.mockResolvedValue(undefined);

    const callOrder: string[] = [];
    mockGetHomeCopyMetaobject.mockImplementation(async () => {
      callOrder.push('getMeta');
      return { id: 'gid://1', fields: [] };
    });
    mockUpdateMetaobjectFields.mockImplementation(async () => {
      callOrder.push('updateMeta');
      return { id: 'gid://1', fields: [] };
    });
    mockGetTranslatableContentDigests.mockImplementation(async () => {
      callOrder.push('getDigests');
      return { hero_title: 'digest-1' };
    });
    mockRegisterTranslations.mockImplementation(async () => {
      callOrder.push('registerTrans');
    });
    mockRevalidateTag.mockImplementation((tag: string) => {
      callOrder.push(`revalidate:${tag}`);
    });

    const { PUT } = await import(
      '@/app/api/admin/configuracion/contenido/route'
    );
    const res = await PUT(
      makeRequest({
        es: { 'hero.title': 'Tu foto' },
        en: { 'hero.title': 'Your photo' },
      }),
    );
    expect(res.status).toBe(200);
    expect(callOrder).toEqual([
      'getMeta',
      'updateMeta',
      'getDigests',
      'registerTrans',
      'revalidate:site-copy',
      'revalidate:site-copy:home',
    ]);
    expect(mockRevalidateTag).toHaveBeenNthCalledWith(1, 'site-copy', {
      expire: 0,
    });
    expect(mockRevalidateTag).toHaveBeenNthCalledWith(2, 'site-copy:home', {
      expire: 0,
    });
  });

  test('maps UI keys (hero.title) to Shopify field keys (hero_title)', async () => {
    mockVerifySession.mockResolvedValue(true);
    mockGetHomeCopyMetaobject.mockResolvedValue({ id: 'gid://1', fields: [] });
    mockUpdateMetaobjectFields.mockResolvedValue({ id: 'gid://1', fields: [] });
    const { PUT } = await import(
      '@/app/api/admin/configuracion/contenido/route'
    );
    await PUT(
      makeRequest({
        es: { 'hero.title': 'Tu foto', 'howItWorks.subtitle': 'Sub' },
      }),
    );
    expect(mockUpdateMetaobjectFields).toHaveBeenCalledTimes(1);
    const fields = mockUpdateMetaobjectFields.mock.calls[0][1] as Array<{
      key: string;
      value: string;
    }>;
    const keys = fields.map((f) => f.key).sort();
    expect(keys).toEqual(['hero_title', 'how_it_works_subtitle']);
  });

  test('metaobject not seeded → 404', async () => {
    mockVerifySession.mockResolvedValue(true);
    mockGetHomeCopyMetaobject.mockResolvedValue(null);
    const { PUT } = await import(
      '@/app/api/admin/configuracion/contenido/route'
    );
    const res = await PUT(makeRequest({ es: { 'hero.title': 'x' } }));
    expect(res.status).toBe(404);
  });

  test('shopify userError on updateMetaobjectFields → 502', async () => {
    mockVerifySession.mockResolvedValue(true);
    mockGetHomeCopyMetaobject.mockResolvedValue({ id: 'gid://1', fields: [] });
    mockUpdateMetaobjectFields.mockRejectedValue(
      new ShopifyUserErrorsError('metaobjectUpdate', [{ message: 'too long' }]),
    );
    const { PUT } = await import(
      '@/app/api/admin/configuracion/contenido/route'
    );
    const res = await PUT(makeRequest({ es: { 'hero.title': 'x' } }));
    expect(res.status).toBe(502);
  });

  test('missing digest for EN key → 502', async () => {
    mockVerifySession.mockResolvedValue(true);
    mockGetHomeCopyMetaobject.mockResolvedValue({ id: 'gid://1', fields: [] });
    mockUpdateMetaobjectFields.mockResolvedValue({ id: 'gid://1', fields: [] });
    mockGetTranslatableContentDigests.mockResolvedValue({}); // empty — no digests
    const { PUT } = await import(
      '@/app/api/admin/configuracion/contenido/route'
    );
    const res = await PUT(
      makeRequest({
        es: { 'hero.title': 'Tu foto' },
        en: { 'hero.title': 'Your photo' },
      }),
    );
    expect(res.status).toBe(502);
    const data = await res.json();
    expect(data.details).toContain('hero_title');
  });

  test('digest scope failure returns actionable translation-scope message', async () => {
    mockVerifySession.mockResolvedValue(true);
    mockGetHomeCopyMetaobject.mockResolvedValue({ id: 'gid://1', fields: [] });
    mockUpdateMetaobjectFields.mockResolvedValue({ id: 'gid://1', fields: [] });
    mockGetTranslatableContentDigests.mockRejectedValue(
      new Error(
        '[Shopify Admin] GraphQL errors:\nAccess denied for translatableResource field. Required access: `read_translations` access scope.',
      ),
    );
    const { PUT } = await import(
      '@/app/api/admin/configuracion/contenido/route'
    );
    const res = await PUT(makeRequest({ en: { 'hero.title': 'Your photo' } }));
    expect(res.status).toBe(502);
    const data = await res.json();
    expect(data.error).toContain('read_translations');
    expect(data.error).toContain('write_translations');
  });

  test('ES-only save skips translation flow', async () => {
    mockVerifySession.mockResolvedValue(true);
    mockGetHomeCopyMetaobject.mockResolvedValue({ id: 'gid://1', fields: [] });
    mockUpdateMetaobjectFields.mockResolvedValue({ id: 'gid://1', fields: [] });
    const { PUT } = await import(
      '@/app/api/admin/configuracion/contenido/route'
    );
    const res = await PUT(makeRequest({ es: { 'hero.title': 'x' } }));
    expect(res.status).toBe(200);
    expect(mockGetTranslatableContentDigests).not.toHaveBeenCalled();
    expect(mockRegisterTranslations).not.toHaveBeenCalled();
    // Cache still revalidated
    expect(mockRevalidateTag).toHaveBeenCalledTimes(2);
  });
});
