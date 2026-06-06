/**
 * Contract test: POST /api/contact (public contact form → Shopify metaobject).
 *
 * Covers: honeypot short-circuit (no Shopify call), validation 400, happy
 * 200 + create called, Shopify throw → 503, oversize body → 413, rate-limit
 * → 429.
 */
import { describe, test, expect, vi, beforeEach } from 'vitest';

const mockCreate = vi.fn();
vi.mock('@/lib/shopify/mutations/contact-submissions', () => ({
  createContactSubmission: (input: unknown) => mockCreate(input),
}));

const mockCheckRateLimit = vi.fn();
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: (key: string) => mockCheckRateLimit(key),
}));

beforeEach(() => {
  mockCreate.mockReset();
  mockCheckRateLimit.mockReset();
  // Default: allow + create succeeds.
  mockCheckRateLimit.mockReturnValue({ allowed: true, retryAfterMs: 0 });
  mockCreate.mockResolvedValue('gid://shopify/Metaobject/1');
});

const VALID = {
  name: 'Ana López',
  email: 'ana@example.com',
  subject: 'Pregunta sobre imanes',
  message: 'Hola, quisiera saber los tiempos de envío a Monterrey.',
};

function postReq(
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
): Request {
  return new Request('http://localhost/api/contact', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

describe('POST /api/contact', () => {
  test('happy path → 200 + createContactSubmission called with mapped fields', async () => {
    const { POST } = await import('@/app/api/contact/route');
    const res = await POST(postReq({ ...VALID, locale: 'es' }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    // The Shopify metaobject id is NOT surfaced to the public client.
    expect(data.id).toBeUndefined();
    expect(mockCreate).toHaveBeenCalledTimes(1);
    const input = mockCreate.mock.calls[0][0] as Record<string, string>;
    expect(input.name).toBe('Ana López');
    expect(input.email).toBe('ana@example.com');
    expect(input.subject).toBe('Pregunta sobre imanes');
    expect(input.status).toBe('new');
    expect(input.source).toBe('contact_form');
    expect(input.locale).toBe('es');
    expect(input.displayName).toContain('Ana López');
    // IP must be hashed, never raw.
    expect(input.ipHash).toMatch(/^[a-f0-9]{64}$/);
    expect(typeof input.createdAt).toBe('string');
  });

  test('honeypot filled → fake 200 + NO Shopify call', async () => {
    const { POST } = await import('@/app/api/contact/route');
    const res = await POST(postReq({ ...VALID, website: 'http://spam.example' }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  test('validation failure → 400 with VALIDATION_ERROR + no create', async () => {
    const { POST } = await import('@/app/api/contact/route');
    const res = await POST(postReq({ ...VALID, email: 'bad' }));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error.code).toBe('VALIDATION_ERROR');
    expect(Array.isArray(data.error.issues)).toBe(true);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  test('Shopify create throws → 503 CONTACT_UNAVAILABLE', async () => {
    mockCreate.mockRejectedValue(new Error('shopify down'));
    const { POST } = await import('@/app/api/contact/route');
    const res = await POST(postReq(VALID));
    expect(res.status).toBe(503);
    const data = await res.json();
    expect(data.error.code).toBe('CONTACT_UNAVAILABLE');
  });

  test('rate-limited → 429 RATE_LIMITED + Retry-After header + no create', async () => {
    mockCheckRateLimit.mockReturnValue({ allowed: false, retryAfterMs: 5000 });
    const { POST } = await import('@/app/api/contact/route');
    const res = await POST(postReq(VALID));
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('5');
    const data = await res.json();
    expect(data.error.code).toBe('RATE_LIMITED');
    expect(mockCreate).not.toHaveBeenCalled();
  });

  test('oversize Content-Length → 413 + no create', async () => {
    const { POST } = await import('@/app/api/contact/route');
    const res = await POST(
      postReq(VALID, { 'content-length': String(20 * 1024) }),
    );
    expect(res.status).toBe(413);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  test('oversize actual body (no/forged Content-Length) → 413', async () => {
    const { POST } = await import('@/app/api/contact/route');
    // 11KB message body; Content-Length header omitted from our manual map but
    // Request will compute it — assert the text-length cap also fires.
    const big = { ...VALID, message: 'x'.repeat(11 * 1024) };
    const res = await POST(postReq(big));
    expect(res.status).toBe(413);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  test('malformed JSON → 400 + no create', async () => {
    const { POST } = await import('@/app/api/contact/route');
    const req = new Request('http://localhost/api/contact', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{ not json',
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  test('rate-limit key is IP-primary (contact: prefix, never the raw email)', async () => {
    const { POST } = await import('@/app/api/contact/route');
    await POST(postReq(VALID));
    expect(mockCheckRateLimit).toHaveBeenCalledTimes(1);
    const key = mockCheckRateLimit.mock.calls[0][0] as string;
    // contact:<12-hex ip hash> — IP is the bucket boundary, email is not in it.
    expect(key).toMatch(/^contact:[a-f0-9]{12}$/);
    expect(key).not.toContain('ana@example.com');
  });
});
