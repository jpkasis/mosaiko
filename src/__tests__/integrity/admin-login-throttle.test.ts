/**
 * Brute-force lockout on POST /api/admin/auth/login (5 failed passwords / IP
 * → 15-min lock). Exercises the REAL in-memory rate-limit + request-ip modules
 * end-to-end; only `@/lib/admin/auth` is mocked. Each test uses a UNIQUE IP so
 * the module-level lockout state never bleeds between tests.
 */
import { describe, test, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

const mockVerify = vi.fn();
const mockCreateSession = vi.fn();
vi.mock('@/lib/admin/auth', () => ({
  verifyPassword: (p: string) => mockVerify(p),
  createSession: () => mockCreateSession(),
}));

beforeEach(() => {
  vi.useRealTimers();
  mockVerify.mockReset();
  mockCreateSession.mockReset();
  mockCreateSession.mockResolvedValue(undefined);
});

function loginReq(password: unknown, ip: string): NextRequest {
  return new Request('http://localhost/api/admin/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify({ password }),
  }) as unknown as NextRequest;
}

describe('POST /api/admin/auth/login — brute-force lockout', () => {
  test('locks after 5 failed attempts → 429 + Retry-After', async () => {
    mockVerify.mockResolvedValue(false);
    const { POST } = await import('@/app/api/admin/auth/login/route');
    const ip = '203.0.113.10';

    for (let i = 0; i < 5; i++) {
      const res = await POST(loginReq('wrong', ip));
      expect(res.status).toBe(401);
    }
    const sixth = await POST(loginReq('wrong', ip));
    expect(sixth.status).toBe(429);
    expect(Number(sixth.headers.get('Retry-After'))).toBeGreaterThan(0);
  });

  test('a locked request never reaches verifyPassword', async () => {
    mockVerify.mockResolvedValue(false);
    const { POST } = await import('@/app/api/admin/auth/login/route');
    const ip = '203.0.113.11';
    for (let i = 0; i < 5; i++) await POST(loginReq('wrong', ip));
    mockVerify.mockClear();
    const res = await POST(loginReq('wrong', ip));
    expect(res.status).toBe(429);
    expect(mockVerify).not.toHaveBeenCalled();
  });

  test('a correct password succeeds and clears the failure counter', async () => {
    const { POST } = await import('@/app/api/admin/auth/login/route');
    const ip = '203.0.113.12';
    mockVerify.mockResolvedValue(false);
    for (let i = 0; i < 4; i++) {
      const r = await POST(loginReq('wrong', ip));
      expect(r.status).toBe(401);
    }
    mockVerify.mockResolvedValue(true);
    const ok = await POST(loginReq('right', ip));
    expect(ok.status).toBe(200);
    expect(mockCreateSession).toHaveBeenCalledTimes(1);
    // Counter was cleared → the next 4 failures still don't lock.
    mockVerify.mockResolvedValue(false);
    for (let i = 0; i < 4; i++) {
      const r = await POST(loginReq('wrong', ip));
      expect(r.status).toBe(401);
    }
  });

  test('missing password → 400 and does not count toward the lock', async () => {
    const { POST } = await import('@/app/api/admin/auth/login/route');
    const ip = '203.0.113.13';
    for (let i = 0; i < 8; i++) {
      const res = await POST(loginReq(undefined, ip));
      expect(res.status).toBe(400);
    }
    mockVerify.mockResolvedValue(false);
    const res = await POST(loginReq('wrong', ip));
    expect(res.status).toBe(401);
  });

  test('a partial streak is NOT forgotten mid-window (cleanup honors the window)', async () => {
    vi.useFakeTimers();
    // Far-future base so the module's cleanup gate (every 5 min) actually fires.
    const BASE = 4_000_000_000_000;
    vi.setSystemTime(BASE);
    mockVerify.mockResolvedValue(false);
    const { POST } = await import('@/app/api/admin/auth/login/route');
    const ip = '203.0.113.20';

    for (let i = 0; i < 4; i++) {
      expect((await POST(loginReq('wrong', ip))).status).toBe(401);
    }
    // 11 min later — still inside the 15-min window. The record must survive
    // cleanup so the 5th failure still locks. (Regression guard: an earlier
    // 10-min cleanup TTL would forget the streak and never lock.)
    vi.setSystemTime(BASE + 11 * 60 * 1000);
    expect((await POST(loginReq('wrong', ip))).status).toBe(401); // 5th → locks
    expect((await POST(loginReq('wrong', ip))).status).toBe(429); // 6th → locked
    vi.useRealTimers();
  });

  test('lock expires after the window → next wrong attempt is 401, not 429', async () => {
    vi.useFakeTimers();
    const BASE = 5_000_000_000_000;
    vi.setSystemTime(BASE);
    mockVerify.mockResolvedValue(false);
    const { POST } = await import('@/app/api/admin/auth/login/route');
    const ip = '203.0.113.21';

    for (let i = 0; i < 5; i++) await POST(loginReq('wrong', ip));
    expect((await POST(loginReq('wrong', ip))).status).toBe(429);
    // Past the lock + counting window → the counter resets, attempts allowed.
    vi.setSystemTime(BASE + 16 * 60 * 1000);
    expect((await POST(loginReq('wrong', ip))).status).toBe(401);
    vi.useRealTimers();
  });
});
