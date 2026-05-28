/**
 * UAT-3 Phase 4 contract test: post-migration residue is gone.
 *
 * Locks the cleanup-phase outcomes so a regression PR can't quietly
 * reintroduce R2 references or unsafe `process.cwd()` dev fallbacks:
 *
 *   - B3: `next.config.ts` `images.remotePatterns` + CSP allowances
 *     never include `r2.mosaiko.mx` again
 *   - A2: `src/middleware.ts` matcher doesn't carry the legacy
 *     `MOSAIKO-images` / `MOSAIKO-logos` exclusions
 *   - A1: `src/lib/cart-composite-blob-cache.ts` cache dir doesn't
 *     resolve under `process.cwd()` by default
 *   - J14: privacy + FAQ copy in `src/messages/{es,en}.json` doesn't
 *     mention Stripe, Resend, or Supabase as providers anymore
 *
 * Source-of-truth approach: read each file, scan for the forbidden
 * substring. If the substring reappears, the test fails before the
 * change ships.
 */
import { describe, test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO_ROOT = resolve(__dirname, '../../..');

function read(rel: string): string {
  return readFileSync(resolve(REPO_ROOT, rel), 'utf-8');
}

describe('UAT-3 Phase 4 — residue removed (Codex audit cleanup)', () => {
  test('B3: next.config.ts has no r2.mosaiko.mx (images + CSP)', () => {
    const src = read('next.config.ts');
    expect(src).not.toMatch(/r2\.mosaiko\.mx/);
  });

  test('A2: middleware matcher does not exclude legacy MOSAIKO-* paths', () => {
    const src = read('src/middleware.ts');
    // Only the matcher string is load-bearing; the historical mention
    // in the comment is documentation. Grab the matcher literal and
    // assert it doesn't carry the legacy exclusions.
    const matcherMatch = src.match(/matcher:\s*\[\s*[\s\S]*?(['"][^'"]+['"])/);
    expect(matcherMatch, 'expected to find a matcher literal').not.toBeNull();
    const matcherLiteral = matcherMatch?.[1] ?? '';
    expect(matcherLiteral).not.toMatch(/MOSAIKO-images/);
    expect(matcherLiteral).not.toMatch(/MOSAIKO-logos/);
  });

  test('A1: cart-composite blob cache does not default under process.cwd()', () => {
    // Allow `process.cwd()` to appear only inside an explanatory comment.
    // The active resolution must use `tmpdir()` and/or an env override.
    const src = read('src/lib/cart-composite-blob-cache.ts');
    // The cache path expression must reference tmpdir() somewhere.
    expect(src).toMatch(/tmpdir\(\)/);
    // No live `path.join(process.cwd(), '.cart-composite-cache')` call.
    expect(src).not.toMatch(
      /path\.join\(\s*process\.cwd\(\)\s*,\s*['"]\.cart-composite-cache['"]/,
    );
  });

  test('J14: privacy + FAQ copy mentions current providers, not legacy ones', () => {
    const es = read('src/messages/es.json');
    const en = read('src/messages/en.json');
    for (const src of [es, en]) {
      expect(src).not.toMatch(/Stripe/);
      expect(src).not.toMatch(/Resend/);
      expect(src).not.toMatch(/Supabase/);
    }
    // Sanity: the current providers ARE listed somewhere.
    expect(es).toMatch(/Mercado Pago/);
    expect(en).toMatch(/Mercado Pago/);
  });

  test.skip('C6/C7: archived cleanup scripts live under scripts/archive/', () => {
    // BISECT (Phase 4 deploy failure): tsconfig.json + scripts/archive/
    // are temporarily reverted to confirm they were the deploy-breaking
    // change. Re-enable + re-archive in a follow-up commit once Vercel
    // accepts the rest of the Phase 4 cleanup.
    const archived = [
      'scripts/archive/cleanup-stale-metafields.mts',
      'scripts/archive/cleanup-orphan-r2-tiles.mts',
      'scripts/archive/README.md',
    ];
    for (const rel of archived) {
      expect(() => read(rel)).not.toThrow();
    }
  });

  test('B5: cart-composite/route.ts has no live "R2" identifiers in comments/logs', () => {
    const src = read('src/app/api/cart-composite/route.ts');
    // Match `R2` as a standalone identifier (not inside another word
    // like `R2D2`). Excluding the `r2_` lowercase env-var pattern if
    // any survives elsewhere — the route file itself shouldn't.
    expect(src).not.toMatch(/\bR2\b/);
  });
});
