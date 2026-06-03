/**
 * UAT-6 PR4 contract test: PUT /api/admin/configuracion/cuenta/password.
 */
import { describe, test, expect, vi, beforeEach } from 'vitest';

const mockVerifySession = vi.fn();
const mockVerifyPassword = vi.fn();
const mockCreateSession = vi.fn();
const mockClearCache = vi.fn();
vi.mock('@/lib/admin/auth', () => ({
  verifySession: () => mockVerifySession(),
  verifyPassword: (p: string) => mockVerifyPassword(p),
  createSession: () => mockCreateSession(),
  clearPasswordHashCache: () => mockClearCache(),
  ADMIN_PASSWORD_METAFIELD_NAMESPACE: 'mosaiko_admin',
  ADMIN_PASSWORD_METAFIELD_KEY: 'password_hash',
}));

const mockGetShopId = vi.fn();
vi.mock('@/lib/shopify/queries/shop', () => ({
  getShopId: () => mockGetShopId(),
}));

const mockSetShopMetafield = vi.fn();
vi.mock('@/lib/shopify/mutations/shop-metafields', () => ({
  setShopMetafield: (...args: unknown[]) => mockSetShopMetafield(...args),
}));

const ShopifyUserErrorsError = class extends Error {
  userErrors: Array<{ message: string }>;
  constructor(op: string, errs: Array<{ message: string }>) {
    super(op);
    this.userErrors = errs;
  }
};
vi.mock('@/lib/shopify/mutations/metaobjects', () => ({ ShopifyUserErrorsError }));

vi.mock('bcryptjs', () => ({
  default: { hash: vi.fn(async () => 'new-bcrypt-hash') },
}));

beforeEach(() => {
  mockVerifySession.mockReset();
  mockVerifyPassword.mockReset();
  mockCreateSession.mockReset();
  mockClearCache.mockReset();
  mockGetShopId.mockReset();
  mockSetShopMetafield.mockReset();
});

function req(body: unknown): Request {
  return new Request('http://localhost/api/admin/configuracion/cuenta/password', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const GOOD = {
  currentPassword: 'old-password',
  newPassword: 'brand-new-password-123',
  confirmPassword: 'brand-new-password-123',
};

describe('PUT cuenta/password', () => {
  test('401 without session', async () => {
    mockVerifySession.mockResolvedValue(false);
    const { PUT } = await import('@/app/api/admin/configuracion/cuenta/password/route');
    const res = await PUT(req(GOOD));
    expect(res.status).toBe(401);
  });

  test('happy path: verify → hash → write → revalidate → reissue session', async () => {
    mockVerifySession.mockResolvedValue(true);
    mockVerifyPassword.mockResolvedValue(true);
    mockGetShopId.mockResolvedValue('gid://shopify/Shop/1');
    mockSetShopMetafield.mockResolvedValue(undefined);
    mockCreateSession.mockResolvedValue('token');
    const { PUT } = await import('@/app/api/admin/configuracion/cuenta/password/route');
    const res = await PUT(req(GOOD));
    expect(res.status).toBe(200);
    expect(mockVerifyPassword).toHaveBeenCalledWith('old-password');
    expect(mockSetShopMetafield).toHaveBeenCalledWith(
      'gid://shopify/Shop/1',
      'mosaiko_admin',
      'password_hash',
      'new-bcrypt-hash',
    );
    expect(mockClearCache).toHaveBeenCalledTimes(1);
    expect(mockCreateSession).toHaveBeenCalledTimes(1);
  });

  test('wrong current password → 403, no write', async () => {
    mockVerifySession.mockResolvedValue(true);
    mockVerifyPassword.mockResolvedValue(false);
    const { PUT } = await import('@/app/api/admin/configuracion/cuenta/password/route');
    const res = await PUT(req(GOOD));
    expect(res.status).toBe(403);
    expect(mockSetShopMetafield).not.toHaveBeenCalled();
  });

  test('mismatch → 400', async () => {
    mockVerifySession.mockResolvedValue(true);
    const { PUT } = await import('@/app/api/admin/configuracion/cuenta/password/route');
    const res = await PUT(
      req({ ...GOOD, confirmPassword: 'different-than-new-12' }),
    );
    expect(res.status).toBe(400);
    expect(mockVerifyPassword).not.toHaveBeenCalled();
  });

  test('too-short new password → 400', async () => {
    mockVerifySession.mockResolvedValue(true);
    const { PUT } = await import('@/app/api/admin/configuracion/cuenta/password/route');
    const res = await PUT(
      req({ currentPassword: 'old', newPassword: 'short', confirmPassword: 'short' }),
    );
    expect(res.status).toBe(400);
  });

  test('new === current → 400', async () => {
    mockVerifySession.mockResolvedValue(true);
    const { PUT } = await import('@/app/api/admin/configuracion/cuenta/password/route');
    const res = await PUT(
      req({
        currentPassword: 'same-password-1234',
        newPassword: 'same-password-1234',
        confirmPassword: 'same-password-1234',
      }),
    );
    expect(res.status).toBe(400);
  });

  test('Shopify write failure → 502', async () => {
    mockVerifySession.mockResolvedValue(true);
    mockVerifyPassword.mockResolvedValue(true);
    mockGetShopId.mockResolvedValue('gid://shopify/Shop/1');
    mockSetShopMetafield.mockRejectedValue(
      new ShopifyUserErrorsError('metafieldsSet', [{ message: 'rejected' }]),
    );
    const { PUT } = await import('@/app/api/admin/configuracion/cuenta/password/route');
    const res = await PUT(req(GOOD));
    expect(res.status).toBe(502);
    expect(mockCreateSession).not.toHaveBeenCalled();
  });
});
