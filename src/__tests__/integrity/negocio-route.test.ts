/**
 * UAT-6 PR4 contract test: GET/PUT /api/admin/configuracion/negocio.
 */
import { describe, test, expect, vi, beforeEach } from 'vitest';

const mockVerifySession = vi.fn();
vi.mock('@/lib/admin/auth', () => ({ verifySession: () => mockVerifySession() }));

const mockGetMetaobject = vi.fn();
const mockGetTranslations = vi.fn();
const mockGetDigests = vi.fn();
vi.mock('@/lib/shopify/queries/metaobjects', () => ({
  getBusinessSettingsMetaobject: () => mockGetMetaobject(),
  getHomeCopyTranslations: (id: string, locale: string) => mockGetTranslations(id, locale),
  getTranslatableContentDigests: (id: string) => mockGetDigests(id),
}));

const mockUpdate = vi.fn();
const mockRegister = vi.fn();
const mockRemove = vi.fn();
const ShopifyUserErrorsError = class extends Error {
  userErrors: Array<{ message: string }>;
  constructor(op: string, errs: Array<{ message: string }>) {
    super(op);
    this.userErrors = errs;
  }
};
vi.mock('@/lib/shopify/mutations/metaobjects', () => ({
  updateMetaobjectFields: (id: string, fields: unknown) => mockUpdate(id, fields),
  registerTranslations: (id: string, locale: string, t: unknown) => mockRegister(id, locale, t),
  removeTranslations: (id: string, locale: string, keys: unknown) => mockRemove(id, locale, keys),
  ShopifyUserErrorsError,
}));

const mockRevalidateTag = vi.fn();
vi.mock('next/cache', () => ({
  revalidateTag: (t: string, p: unknown) => mockRevalidateTag(t, p),
  revalidatePath: vi.fn(),
  unstable_cache: <Args extends unknown[], R>(fn: (...args: Args) => Promise<R>) => fn,
}));

beforeEach(() => {
  mockVerifySession.mockReset();
  mockGetMetaobject.mockReset();
  mockGetTranslations.mockReset();
  mockGetDigests.mockReset();
  mockUpdate.mockReset();
  mockRegister.mockReset();
  mockRemove.mockReset();
  mockRevalidateTag.mockReset();
});

function putReq(settings: Record<string, unknown>): Request {
  return new Request('http://localhost/api/admin/configuracion/negocio', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ settings }),
  });
}

describe('GET negocio', () => {
  test('401 without session', async () => {
    mockVerifySession.mockResolvedValue(false);
    const { GET } = await import('@/app/api/admin/configuracion/negocio/route');
    expect((await GET()).status).toBe(401);
  });

  test('hydrates base + EN translations', async () => {
    mockVerifySession.mockResolvedValue(true);
    mockGetMetaobject.mockResolvedValue({
      id: 'gid://1',
      fields: [
        { key: 'business_name', value: 'Mosaiko' },
        { key: 'phone', value: '555' },
        { key: 'notification_email', value: 'a@b.com' },
      ],
    });
    mockGetTranslations.mockResolvedValue([
      { key: 'business_name', value: 'Mosaiko EN', outdated: false },
    ]);
    const { GET } = await import('@/app/api/admin/configuracion/negocio/route');
    const res = await GET();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.settings.businessName.es).toBe('Mosaiko');
    expect(data.settings.businessName.en).toBe('Mosaiko EN');
    expect(data.settings.phone).toBe('555');
    expect(data.settings.notificationEmail).toBe('a@b.com');
  });

  test('metaobject not seeded → 500', async () => {
    mockVerifySession.mockResolvedValue(true);
    mockGetMetaobject.mockResolvedValue(null);
    const { GET } = await import('@/app/api/admin/configuracion/negocio/route');
    expect((await GET()).status).toBe(500);
  });
});

describe('PUT negocio', () => {
  test('401 without session', async () => {
    mockVerifySession.mockResolvedValue(false);
    const { PUT } = await import('@/app/api/admin/configuracion/negocio/route');
    expect((await PUT(putReq({}))).status).toBe(401);
  });

  test('bad email → 400', async () => {
    mockVerifySession.mockResolvedValue(true);
    const { PUT } = await import('@/app/api/admin/configuracion/negocio/route');
    const res = await PUT(putReq({ notificationEmail: 'bad' }));
    expect(res.status).toBe(400);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  test('happy ES + neutral, no EN → updates base, skips translation flow, revalidates', async () => {
    mockVerifySession.mockResolvedValue(true);
    mockGetMetaobject.mockResolvedValue({ id: 'gid://1', fields: [] });
    mockUpdate.mockResolvedValue({ id: 'gid://1', fields: [] });
    const { PUT } = await import('@/app/api/admin/configuracion/negocio/route');
    const res = await PUT(
      putReq({
        businessName: { es: 'Mosaiko', en: '' },
        footerCopy: { es: '', en: '' },
        address: 'CDMX',
        phone: '555',
      }),
    );
    expect(res.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    // EN business_name + footer_copy both empty → both removed, none registered
    expect(mockRemove).toHaveBeenCalledWith('gid://1', 'en', ['business_name', 'footer_copy']);
    expect(mockGetDigests).not.toHaveBeenCalled();
    expect(mockRegister).not.toHaveBeenCalled();
    expect(mockRevalidateTag).toHaveBeenCalledWith('site-copy:business', { expire: 0 });
  });

  test('non-empty EN → register; empty EN → remove (partition)', async () => {
    mockVerifySession.mockResolvedValue(true);
    mockGetMetaobject.mockResolvedValue({ id: 'gid://1', fields: [] });
    mockUpdate.mockResolvedValue({ id: 'gid://1', fields: [] });
    mockGetDigests.mockResolvedValue({ business_name: 'digest-bn' });
    const { PUT } = await import('@/app/api/admin/configuracion/negocio/route');
    const res = await PUT(
      putReq({
        businessName: { es: 'Mosaiko', en: 'Mosaiko EN' },
        footerCopy: { es: 'Pie', en: '' },
      }),
    );
    expect(res.status).toBe(200);
    // footer_copy EN empty → removed
    expect(mockRemove).toHaveBeenCalledWith('gid://1', 'en', ['footer_copy']);
    // business_name EN non-empty → registered with its digest
    expect(mockRegister).toHaveBeenCalledTimes(1);
    const regArg = mockRegister.mock.calls[0][2] as Array<{ key: string; value: string }>;
    expect(regArg).toEqual([
      { key: 'business_name', value: 'Mosaiko EN', translatableContentDigest: 'digest-bn' },
    ]);
  });

  test('metaobjectUpdate userErrors → 502', async () => {
    mockVerifySession.mockResolvedValue(true);
    mockGetMetaobject.mockResolvedValue({ id: 'gid://1', fields: [] });
    mockUpdate.mockRejectedValue(new ShopifyUserErrorsError('metaobjectUpdate', [{ message: 'x' }]));
    const { PUT } = await import('@/app/api/admin/configuracion/negocio/route');
    const res = await PUT(putReq({ address: 'CDMX' }));
    expect(res.status).toBe(502);
  });

  test('metaobject not seeded → 500', async () => {
    mockVerifySession.mockResolvedValue(true);
    mockGetMetaobject.mockResolvedValue(null);
    const { PUT } = await import('@/app/api/admin/configuracion/negocio/route');
    expect((await PUT(putReq({ address: 'CDMX' }))).status).toBe(500);
  });
});
