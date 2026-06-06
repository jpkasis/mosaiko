/**
 * Contract test: public contact-form submission validator.
 */
import { describe, test, expect } from 'vitest';
import {
  validateContactSubmission,
  CONTACT_BOUNDS,
} from '@/lib/contact/validation';

const VALID = {
  name: 'Ana López',
  email: 'ana@example.com',
  subject: 'Pregunta sobre imanes',
  message: 'Hola, quisiera saber los tiempos de envío a Monterrey.',
};

describe('validateContactSubmission', () => {
  test('accepts a full valid body + trims', () => {
    const r = validateContactSubmission({
      ...VALID,
      name: '  Ana López  ',
      subject: '  Pregunta  ',
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.name).toBe('Ana López');
      expect(r.value.subject).toBe('Pregunta');
      expect(r.value.email).toBe('ana@example.com');
    }
  });

  test('rejects a non-object body', () => {
    const r = validateContactSubmission(null);
    expect(r.ok).toBe(false);
  });

  test('rejects blank required fields (name/subject/message)', () => {
    const r = validateContactSubmission({ ...VALID, name: '   ' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues.some((i) => i.field === 'name')).toBe(true);
  });

  test('rejects invalid email', () => {
    const r = validateContactSubmission({ ...VALID, email: 'not-an-email' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues.some((i) => i.field === 'email')).toBe(true);
  });

  test('rejects name over max', () => {
    const r = validateContactSubmission({
      ...VALID,
      name: 'x'.repeat(CONTACT_BOUNDS.name.max + 1),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues.some((i) => i.field === 'name')).toBe(true);
  });

  test('rejects subject over max', () => {
    const r = validateContactSubmission({
      ...VALID,
      subject: 'x'.repeat(CONTACT_BOUNDS.subject.max + 1),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues.some((i) => i.field === 'subject')).toBe(true);
  });

  test('rejects message below min (10 chars)', () => {
    const r = validateContactSubmission({ ...VALID, message: 'corto' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues.some((i) => i.field === 'message')).toBe(true);
  });

  test('rejects message over max (2000 chars)', () => {
    const r = validateContactSubmission({
      ...VALID,
      message: 'x'.repeat(CONTACT_BOUNDS.message.max + 1),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues.some((i) => i.field === 'message')).toBe(true);
  });

  test('accepts message exactly at min', () => {
    const r = validateContactSubmission({
      ...VALID,
      message: 'x'.repeat(CONTACT_BOUNDS.message.min),
    });
    expect(r.ok).toBe(true);
  });

  test('collects multiple issues before returning', () => {
    const r = validateContactSubmission({
      name: '',
      email: 'bad',
      subject: '',
      message: 'short',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues.length).toBeGreaterThanOrEqual(3);
  });

  test('ignores the website honeypot field (not part of value)', () => {
    const r = validateContactSubmission({ ...VALID, website: 'http://spam.com' });
    // Validator does not inspect the honeypot — that is the route's job.
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect('website' in r.value).toBe(false);
    }
  });
});
