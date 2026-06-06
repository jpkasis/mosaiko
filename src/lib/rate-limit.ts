// ─── In-memory token bucket rate limiter ────────────────────────────────────
//
// Suitable for single-instance deployments (Vercel serverless resets on cold start).
// For distributed rate limiting, swap for Upstash Redis or Vercel KV.

interface TokenBucket {
  tokens: number;
  lastRefill: number;
}

interface RateLimitConfig {
  /** Max burst tokens */
  maxTokens: number;
  /** Refill interval in milliseconds */
  refillIntervalMs: number;
}

const buckets = new Map<string, TokenBucket>();
const failures = new Map<string, FailureRecord>();

// Clean up stale buckets / failure records every 5 minutes to prevent leaks
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
const BUCKET_TTL_MS = 10 * 60 * 1000;

let lastCleanup = Date.now();

function cleanup() {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL_MS) return;
  lastCleanup = now;

  for (const [key, bucket] of buckets) {
    if (now - bucket.lastRefill > BUCKET_TTL_MS) {
      buckets.delete(key);
    }
  }
  // Drop failure records that are no longer locked and whose counting window
  // has fully elapsed. Use each record's OWN window (not BUCKET_TTL_MS) so a
  // partial failure streak is never forgotten mid-window — that would let an
  // attacker exceed maxFailures within the intended window.
  for (const [key, rec] of failures) {
    if (rec.lockedUntil <= now && now - rec.windowStart > rec.windowMs) {
      failures.delete(key);
    }
  }
}

export function checkRateLimit(
  key: string,
  config: RateLimitConfig = { maxTokens: 10, refillIntervalMs: 5000 },
): { allowed: boolean; retryAfterMs: number } {
  cleanup();

  const now = Date.now();
  let bucket = buckets.get(key);

  if (!bucket) {
    bucket = { tokens: config.maxTokens - 1, lastRefill: now };
    buckets.set(key, bucket);
    return { allowed: true, retryAfterMs: 0 };
  }

  // Refill tokens based on elapsed time
  const elapsed = now - bucket.lastRefill;
  const refills = Math.floor(elapsed / config.refillIntervalMs);

  if (refills > 0) {
    bucket.tokens = Math.min(config.maxTokens, bucket.tokens + refills);
    bucket.lastRefill += refills * config.refillIntervalMs;
  }

  if (bucket.tokens > 0) {
    bucket.tokens -= 1;
    return { allowed: true, retryAfterMs: 0 };
  }

  // No tokens available — calculate when next one arrives
  const retryAfterMs = config.refillIntervalMs - (now - bucket.lastRefill);
  return { allowed: false, retryAfterMs: Math.max(retryAfterMs, 1000) };
}

// ─── Failure-window lockout (brute-force protection) ────────────────────────
//
// Distinct from the token bucket: counts FAILED attempts only and locks a key
// for a fixed window once a threshold is reached. Successful attempts call
// clearFailures(), so legitimate users are never penalized — only repeated
// failures (e.g. password guessing) trip the lock. In-memory + per-instance
// like the bucket above; a perimeter rule (Cloudflare) is the cross-instance
// backstop. Designed for the admin login.

interface FailureRecord {
  failures: number;
  /** Start of the current rolling counting window. */
  windowStart: number;
  /** Length of this record's counting window (ms) — drives cleanup so a record
   *  is never pruned before its own window elapses. */
  windowMs: number;
  /** Epoch ms until which the key is locked (0 = not locked). */
  lockedUntil: number;
}

export interface LockoutConfig {
  /** Failures within the window that trip the lock. */
  maxFailures: number;
  /** Rolling window for counting failures (ms). */
  windowMs: number;
  /** How long a triggered lock lasts (ms). */
  lockMs: number;
}

export const DEFAULT_LOCKOUT: LockoutConfig = {
  maxFailures: 5,
  windowMs: 15 * 60 * 1000,
  lockMs: 15 * 60 * 1000,
};

/** Is this key currently locked out? Read-only (does not record anything). */
export function checkLockout(key: string): { locked: boolean; retryAfterMs: number } {
  cleanup();
  const rec = failures.get(key);
  if (!rec) return { locked: false, retryAfterMs: 0 };
  const now = Date.now();
  if (rec.lockedUntil > now) {
    return { locked: true, retryAfterMs: rec.lockedUntil - now };
  }
  return { locked: false, retryAfterMs: 0 };
}

/**
 * Record one failed attempt. Starts a fresh window if none is active (or the
 * previous one fully elapsed); locks the key once `maxFailures` is reached
 * within the window.
 */
export function recordFailure(key: string, config: LockoutConfig = DEFAULT_LOCKOUT): void {
  const now = Date.now();
  const rec = failures.get(key);
  if (!rec || now - rec.windowStart > config.windowMs) {
    failures.set(key, {
      failures: 1,
      windowStart: now,
      windowMs: config.windowMs,
      lockedUntil: 0,
    });
    return;
  }
  rec.failures += 1;
  if (rec.failures >= config.maxFailures) {
    rec.lockedUntil = now + config.lockMs;
  }
}

/** Clear a key's failure record (call after a successful attempt). */
export function clearFailures(key: string): void {
  failures.delete(key);
}
