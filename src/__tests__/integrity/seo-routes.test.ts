/**
 * Phase 7 SEO/indexing hygiene: robots.txt gates crawlers by deployment env,
 * and the sitemap lists the public routes with es/en hreflang alternates.
 */
import { describe, test, expect, vi, afterEach } from 'vitest';
import robots from '@/app/robots';
import sitemap from '@/app/sitemap';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('robots.txt', () => {
  test('PRODUCTION → crawlable, advertises the sitemap, blocks admin + api', () => {
    vi.stubEnv('VERCEL_ENV', 'production');
    const r = robots();
    expect(r.sitemap).toMatch(/\/sitemap\.xml$/);
    const rules = Array.isArray(r.rules) ? r.rules[0] : r.rules;
    expect(rules.allow).toBe('/');
    expect(rules.disallow).toEqual(expect.arrayContaining(['/admin', '/api/']));
  });

  test('PREVIEW / non-production → disallow everything (never competes with prod)', () => {
    vi.stubEnv('VERCEL_ENV', 'preview');
    const rules = robots().rules;
    const first = Array.isArray(rules) ? rules[0] : rules;
    expect(first.disallow).toBe('/');
    expect(robots().sitemap).toBeUndefined();
  });
});

describe('sitemap.xml', () => {
  test('lists public routes, home first at priority 1, each with es+en hreflang', () => {
    const entries = sitemap();
    expect(entries.length).toBeGreaterThanOrEqual(9);

    const home = entries[0];
    expect(home.url).toMatch(/\/$|mosaiko/);
    expect(home.priority).toBe(1);

    for (const e of entries) {
      const langs = e.alternates?.languages as Record<string, string> | undefined;
      expect(langs?.es).toBeTruthy();
      expect(langs?.en).toBeTruthy();
      expect(langs!.en).toContain('/en');
    }
  });

  test('excludes non-indexable routes (cart, order-confirmed, dynamic detail)', () => {
    const urls = sitemap().map((e) => e.url);
    expect(urls.some((u) => u.includes('/carrito'))).toBe(false);
    expect(urls.some((u) => u.includes('/pedido-confirmado'))).toBe(false);
    expect(urls.some((u) => u.includes('['))).toBe(false);
  });
});
