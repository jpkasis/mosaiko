/**
 * Regression pin (Codex audit MAJOR): the print-files / retry routes return
 * errors as EITHER a plain string (`{ error: 'mensaje' }`) or the server
 * guard's structured shape (`{ error: { code: 'order_check_unavailable' } }`).
 * The grid stores the result in React state and renders it as text, so the
 * normalizer MUST always yield a string — passing the structured object through
 * crashed the render ("Objects are not valid as a React child").
 */
import { describe, test, expect } from 'vitest';
import { errorToMessage } from '@/components/admin/PrintFilesGrid';

describe('errorToMessage', () => {
  test('plain string error passes through', () => {
    expect(errorToMessage({ error: 'Línea no encontrada.' }, 'fallback')).toBe(
      'Línea no encontrada.',
    );
  });

  test('structured guard 503 → Spanish string (NOT the object)', () => {
    const out = errorToMessage({ error: { code: 'order_check_unavailable' } }, 'fallback');
    expect(typeof out).toBe('string');
    expect(out).toContain('verificar');
  });

  test('structured guard 409 → Spanish string', () => {
    const out = errorToMessage({ error: { code: 'order_not_processable' } }, 'fallback');
    expect(typeof out).toBe('string');
    expect(out).toContain('procesable');
  });

  test('unknown structured code → fallback (still a string)', () => {
    expect(errorToMessage({ error: { code: 'something_new' } }, 'fallback')).toBe('fallback');
  });

  test('empty / malformed bodies → fallback', () => {
    expect(errorToMessage({}, 'fallback')).toBe('fallback');
    expect(errorToMessage(null, 'fallback')).toBe('fallback');
    expect(errorToMessage(undefined, 'fallback')).toBe('fallback');
  });

  test('every branch returns a primitive string', () => {
    for (const body of [
      { error: 'x' },
      { error: { code: 'order_check_unavailable' } },
      { error: { code: 'order_not_processable' } },
      { error: { code: 'zzz' } },
      { error: 42 },
      {},
      null,
    ]) {
      expect(typeof errorToMessage(body, 'fb')).toBe('string');
    }
  });
});
