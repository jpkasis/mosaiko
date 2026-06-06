import { NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateContactSubmission } from '@/lib/contact/validation';
import {
  createContactSubmission,
  type ContactSubmissionInput,
} from '@/lib/shopify/mutations/contact-submissions';

// node:crypto + the Admin API client require the Node.js runtime.
export const runtime = 'nodejs';

// ─── POST /api/contact ──────────────────────────────────────────────────────
//
// Public, unauthenticated. Stores the submission as a PRIVATE Shopify
// metaobject (mosaiko_contact_submission, storefront access NONE). Anti-spam
// is honeypot + in-memory rate-limit + body cap ONLY — no external services.

// Max raw body we'll read. message caps at 2000 chars; 10KB leaves generous
// headroom for the other fields + JSON overhead while bounding abuse.
const MAX_BODY_BYTES = 10 * 1024;

function badRequest(code: string, extra?: Record<string, unknown>): NextResponse {
  return NextResponse.json({ error: { code, ...extra } }, { status: 400 });
}

/** Resolves the best-effort client IP from edge/proxy headers. */
function clientIp(request: Request): string {
  const cf = request.headers.get('cf-connecting-ip');
  if (cf) return cf.trim();
  const xff = request.headers.get('x-forwarded-for');
  if (xff) {
    const first = xff.split(',')[0]?.trim();
    if (first) return first;
  }
  return 'unknown';
}

/** Short, stable hash of an IP for rate-limit keying (not stored). */
function shortHash(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 12);
}

/** Picks the request locale: explicit body field, else Accept-Language, else es. */
function resolveLocale(bodyLocale: unknown, request: Request): string {
  if (bodyLocale === 'en') return 'en';
  if (bodyLocale === 'es') return 'es';
  const accept = request.headers.get('accept-language')?.toLowerCase() ?? '';
  return accept.startsWith('en') ? 'en' : 'es';
}

export async function POST(request: Request): Promise<NextResponse> {
  // ── 1. Body cap (Content-Length + hard byte cap before JSON.parse) ──────
  const declaredLength = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return NextResponse.json({ error: { code: 'PAYLOAD_TOO_LARGE' } }, { status: 413 });
  }

  let rawText: string;
  try {
    rawText = await request.text();
  } catch {
    return badRequest('VALIDATION_ERROR');
  }
  if (Buffer.byteLength(rawText, 'utf8') > MAX_BODY_BYTES) {
    return NextResponse.json({ error: { code: 'PAYLOAD_TOO_LARGE' } }, { status: 413 });
  }

  let body: unknown;
  try {
    body = JSON.parse(rawText);
  } catch {
    return badRequest('VALIDATION_ERROR');
  }
  const bodyObj =
    typeof body === 'object' && body !== null
      ? (body as Record<string, unknown>)
      : {};

  // ── 2. Honeypot — non-empty `website` ⇒ silently accept, store nothing ──
  const website = bodyObj.website;
  if (typeof website === 'string' && website.trim().length > 0) {
    return NextResponse.json({ ok: true });
  }

  // ── 3. Rate limit (IP-primary, BEFORE validation work) ──────────────────
  // Key on the IP hash only. Keying by email would let a bot rotate the
  // address for fresh buckets, so the IP is the bucket boundary. 3/min.
  // (Codex audit)
  const ip = clientIp(request);
  const { allowed, retryAfterMs } = checkRateLimit(`contact:${shortHash(ip)}`, {
    maxTokens: 3,
    refillIntervalMs: 60_000,
  });
  if (!allowed) {
    return NextResponse.json(
      { error: { code: 'RATE_LIMITED' } },
      {
        status: 429,
        headers: { 'Retry-After': String(Math.ceil(retryAfterMs / 1000)) },
      },
    );
  }

  // ── 4. Validate ─────────────────────────────────────────────────────────
  const result = validateContactSubmission(bodyObj);
  if (!result.ok) {
    return badRequest('VALIDATION_ERROR', { issues: result.issues });
  }
  const { name, email, subject, message } = result.value;

  // ── 5. Build + store ────────────────────────────────────────────────────
  // Hash the IP with the webhook secret as a pepper — store the HASH, never
  // the raw IP. Reuses an existing env var (no new config).
  const ipHash = createHash('sha256')
    .update(ip + (process.env.SHOPIFY_WEBHOOK_SECRET ?? ''))
    .digest('hex');
  const locale = resolveLocale(bodyObj.locale, request);

  const input: ContactSubmissionInput = {
    displayName: `${name} — ${subject}`.slice(0, 100),
    name,
    email,
    subject,
    message,
    status: 'new',
    createdAt: new Date().toISOString(),
    ipHash,
    locale,
    source: 'contact_form',
  };

  try {
    // Don't surface the Shopify metaobject id to the public client.
    await createContactSubmission(input);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[api/contact] createContactSubmission failed:', error);
    return NextResponse.json(
      { error: { code: 'CONTACT_UNAVAILABLE' } },
      { status: 503 },
    );
  }
}
