/**
 * Integrity test: buildPersonalizarHref shape
 *
 * Single helper consumed by catalog cards, product detail pages,
 * the home carousel, and any future builder deep-link. Failure here
 * means URL construction has drifted between callers — exactly the
 * bug the helper is supposed to prevent.
 */
import { describe, test, expect } from 'vitest';
import { buildPersonalizarHref } from '@/lib/builder-href';

describe('buildPersonalizarHref', () => {
  test('emits typed pathname + query for mosaicos 9-piece', () => {
    expect(buildPersonalizarHref({ category: 'mosaicos', gridSize: 9 })).toEqual({
      pathname: '/personalizar',
      query: { category: 'mosaicos', grid: '9' },
    });
  });

  test('emits typed pathname + query for save-the-date 3-piece (UAT-1b deep-link)', () => {
    expect(buildPersonalizarHref({ category: 'save-the-date', gridSize: 3 })).toEqual({
      pathname: '/personalizar',
      query: { category: 'save-the-date', grid: '3' },
    });
  });

  test('stringifies gridSize so Next.js Link accepts the query value', () => {
    const href = buildPersonalizarHref({ category: 'polaroid', gridSize: 4 });
    if (!('grid' in href.query)) throw new Error('Expected grid in query');
    expect(href.query.grid).toBe('4');
    expect(typeof href.query.grid).toBe('string');
  });

  test('all seven categories produce well-formed hrefs', () => {
    const categories = ['mosaicos', 'spotify', 'tonos', 'save-the-date', 'arte', 'studio', 'polaroid'] as const;
    for (const category of categories) {
      const href = buildPersonalizarHref({ category, gridSize: 6 });
      expect(href.pathname).toBe('/personalizar');
      expect(href.query.category).toBe(category);
      if (!('grid' in href.query)) throw new Error('Expected grid in query');
      expect(href.query.grid).toBe('6');
    }
  });

  test('category-only overload omits grid from query', () => {
    const href = buildPersonalizarHref({ category: 'mosaicos' });
    expect(href.pathname).toBe('/personalizar');
    expect(href.query.category).toBe('mosaicos');
    expect('grid' in href.query).toBe(false);
  });
});
