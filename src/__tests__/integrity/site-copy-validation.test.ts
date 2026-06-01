/**
 * UAT-6 PR3 contract test: site-copy admin save payload validator.
 *
 * Locks the schema the admin form must respect:
 *   - only `es` + `en` top-level locales
 *   - only HOME_COPY_MAP keys allowed
 *   - all values must be strings
 *   - max lengths enforced (badge/cta 120, titles 160, subtitles 500)
 *   - empty strings allowed (intentional clear → static JSON fallback)
 *   - values trimmed before save
 */
import { describe, test, expect } from 'vitest';
import {
  validateContenidoBody,
  ContenidoValidationError,
  MAX_LENGTHS,
} from '@/lib/admin/site-copy-validation';

describe('validateContenidoBody', () => {
  test('accepts a valid full body', () => {
    const result = validateContenidoBody({
      es: {
        'hero.badge': 'Imanes personalizados',
        'hero.title': 'Tu foto, tus imanes',
        'hero.cta': 'Crear ahora',
      },
      en: {
        'hero.title': 'Your photo, your magnets',
      },
    });
    expect(result.es['hero.badge']).toBe('Imanes personalizados');
    expect(result.es['hero.title']).toBe('Tu foto, tus imanes');
    expect(result.en['hero.title']).toBe('Your photo, your magnets');
  });

  test('rejects unknown top-level locale', () => {
    expect(() =>
      validateContenidoBody({
        es: { 'hero.title': 'x' },
        fr: { 'hero.title': 'x' },
      }),
    ).toThrow(ContenidoValidationError);
  });

  test('rejects unknown nested key', () => {
    try {
      validateContenidoBody({
        es: { 'hero.unknownKey': 'value' },
      });
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(ContenidoValidationError);
      const issues = (e as ContenidoValidationError).issues;
      expect(issues.some((i) => i.path === 'hero.unknownKey')).toBe(true);
    }
  });

  test('rejects non-string value', () => {
    try {
      validateContenidoBody({
        es: { 'hero.title': 123 },
      });
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(ContenidoValidationError);
      const issues = (e as ContenidoValidationError).issues;
      expect(issues.some((i) => i.path === 'hero.title')).toBe(true);
    }
  });

  test('rejects non-object body', () => {
    expect(() => validateContenidoBody('not an object')).toThrow(
      ContenidoValidationError,
    );
    expect(() => validateContenidoBody(null)).toThrow(ContenidoValidationError);
    expect(() => validateContenidoBody([])).toThrow(ContenidoValidationError);
  });

  test('rejects non-object locale body', () => {
    expect(() =>
      validateContenidoBody({ es: 'string-not-object' }),
    ).toThrow(ContenidoValidationError);
  });

  test('trims values', () => {
    const result = validateContenidoBody({
      es: { 'hero.title': '   padded title   ' },
    });
    expect(result.es['hero.title']).toBe('padded title');
  });

  test('accepts empty string (intentional clear)', () => {
    const result = validateContenidoBody({
      es: { 'hero.title': '' },
    });
    expect(result.es['hero.title']).toBe('');
  });

  test('enforces max length for badge/cta (120)', () => {
    const tooLong = 'x'.repeat(121);
    expect(() =>
      validateContenidoBody({ es: { 'hero.cta': tooLong } }),
    ).toThrow(ContenidoValidationError);
    expect(MAX_LENGTHS['hero.cta']).toBe(120);
  });

  test('enforces max length for titles (160)', () => {
    const tooLong = 'x'.repeat(161);
    expect(() =>
      validateContenidoBody({ es: { 'hero.title': tooLong } }),
    ).toThrow(ContenidoValidationError);
    expect(MAX_LENGTHS['hero.title']).toBe(160);
  });

  test('enforces max length for subtitles (500)', () => {
    const tooLong = 'x'.repeat(501);
    expect(() =>
      validateContenidoBody({ es: { 'hero.subtitle': tooLong } }),
    ).toThrow(ContenidoValidationError);
    expect(MAX_LENGTHS['hero.subtitle']).toBe(500);
  });

  test('partial body (only one locale) is valid', () => {
    const result = validateContenidoBody({
      es: { 'hero.title': 'Sólo español' },
    });
    expect(result.es['hero.title']).toBe('Sólo español');
    expect(Object.keys(result.en)).toHaveLength(0);
  });

  test('collects multiple issues before throwing', () => {
    try {
      validateContenidoBody({
        es: {
          'hero.unknownKey': 'a',
          'hero.title': 123,
          'hero.subtitle': 'x'.repeat(600),
        },
      });
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(ContenidoValidationError);
      const issues = (e as ContenidoValidationError).issues;
      expect(issues.length).toBeGreaterThanOrEqual(3);
    }
  });
});
