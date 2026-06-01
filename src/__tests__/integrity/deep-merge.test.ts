/**
 * UAT-6 PR2 contract test: deep-merge helper used by the next-intl
 * request boundary to layer Shopify Metaobject overrides on top of
 * static JSON message dictionaries.
 *
 * Semantics locked:
 *   - Nested plain objects merge recursively
 *   - Override primitive replaces fallback primitive
 *   - Arrays REPLACE (no concat) — message arrays are rare; element-merge
 *     would create surprising behavior
 *   - Base input is not mutated (pure function)
 *   - `null` in the override is treated as "explicit absence" — base wins
 */
import { describe, test, expect } from 'vitest';
import { deepMerge } from '@/lib/deep-merge';

describe('deepMerge', () => {
  test('recursively merges nested objects', () => {
    const base = { hero: { title: 'A', subtitle: 'B' }, footer: { copy: 'C' } };
    const override = { hero: { title: 'A2' } };
    const out = deepMerge(base, override);
    expect(out).toEqual({
      hero: { title: 'A2', subtitle: 'B' },
      footer: { copy: 'C' },
    });
  });

  test('override primitive replaces fallback primitive', () => {
    const base = { count: 1, name: 'x' };
    const override = { count: 42 };
    const out = deepMerge(base, override);
    expect(out).toEqual({ count: 42, name: 'x' });
  });

  test('arrays REPLACE (do not concat)', () => {
    const base = { tags: ['a', 'b', 'c'] };
    const override = { tags: ['z'] };
    const out = deepMerge(base, override);
    expect(out.tags).toEqual(['z']);
  });

  test('base input is not mutated', () => {
    const base = { hero: { title: 'A' } };
    const baseSnapshot = JSON.parse(JSON.stringify(base));
    deepMerge(base, { hero: { title: 'B' } });
    expect(base).toEqual(baseSnapshot);
  });

  test('null in override means "explicit absence" — base wins', () => {
    const base = { hero: { title: 'A' } };
    const override = { hero: null };
    // @ts-expect-error - testing null behavior intentionally
    const out = deepMerge(base, override);
    expect(out).toEqual({ hero: { title: 'A' } });
  });

  test('object overriding primitive replaces', () => {
    const base = { x: 'string' };
    const override = { x: { nested: 'value' } };
    const out = deepMerge(base, override);
    expect(out).toEqual({ x: { nested: 'value' } });
  });

  test('primitive overriding object replaces', () => {
    const base = { x: { nested: 'value' } };
    const override = { x: 'string' };
    // @ts-expect-error - shape change intentional
    const out = deepMerge(base, override);
    expect(out).toEqual({ x: 'string' });
  });
});
