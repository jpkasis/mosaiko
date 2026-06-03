/**
 * UAT-6 PR4 contract test: business-settings save validator.
 */
import { describe, test, expect } from 'vitest';
import {
  validateBusinessSettings,
  BusinessSettingsValidationError,
} from '@/lib/admin/business-settings-validation';

function wrap(settings: Record<string, unknown>) {
  return { settings };
}

describe('validateBusinessSettings', () => {
  test('accepts a full valid body + trims', () => {
    const r = validateBusinessSettings(
      wrap({
        businessName: { es: '  Mosaiko  ', en: 'Mosaiko EN' },
        footerCopy: { es: 'Pie ES', en: 'Footer EN' },
        address: '  CDMX  ',
        phone: '55 1234 5678',
        whatsapp: '+52 1 55 1234 5678',
        instagramUrl: 'instagram.com/mosaiko',
        facebookUrl: 'https://facebook.com/mosaiko',
        notificationEmail: 'a@b.com',
      }),
    );
    expect(r.businessName.es).toBe('Mosaiko');
    expect(r.address).toBe('CDMX');
    // WhatsApp normalized to +digits
    expect(r.whatsapp).toBe('+5215512345678');
    // Instagram normalized to https
    expect(r.instagramUrl).toBe('https://instagram.com/mosaiko');
    expect(r.facebookUrl).toBe('https://facebook.com/mosaiko');
  });

  test('rejects missing settings object', () => {
    expect(() => validateBusinessSettings({})).toThrow(
      BusinessSettingsValidationError,
    );
    expect(() => validateBusinessSettings(null)).toThrow(
      BusinessSettingsValidationError,
    );
  });

  test('rejects invalid email', () => {
    expect(() =>
      validateBusinessSettings(wrap({ notificationEmail: 'not-an-email' })),
    ).toThrow(BusinessSettingsValidationError);
  });

  test('accepts empty email (optional)', () => {
    const r = validateBusinessSettings(wrap({ notificationEmail: '' }));
    expect(r.notificationEmail).toBe('');
  });

  test('rejects over-max localized field', () => {
    expect(() =>
      validateBusinessSettings(
        wrap({ businessName: { es: 'x'.repeat(121), en: '' } }),
      ),
    ).toThrow(BusinessSettingsValidationError);
  });

  test('rejects non-string neutral field', () => {
    expect(() =>
      validateBusinessSettings(wrap({ address: 123 })),
    ).toThrow(BusinessSettingsValidationError);
  });

  test('blank neutral fields allowed (clears)', () => {
    const r = validateBusinessSettings(
      wrap({ address: '', phone: '', whatsapp: '' }),
    );
    expect(r.address).toBe('');
    expect(r.phone).toBe('');
    expect(r.whatsapp).toBe('');
  });

  test('empty URL fields stay empty (no https prefix)', () => {
    const r = validateBusinessSettings(
      wrap({ instagramUrl: '', facebookUrl: '' }),
    );
    expect(r.instagramUrl).toBe('');
    expect(r.facebookUrl).toBe('');
  });

  test('collects multiple issues before throwing', () => {
    try {
      validateBusinessSettings(
        wrap({
          notificationEmail: 'bad',
          businessName: { es: 'x'.repeat(200), en: '' },
        }),
      );
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(BusinessSettingsValidationError);
      expect((e as BusinessSettingsValidationError).issues.length).toBeGreaterThanOrEqual(2);
    }
  });
});
