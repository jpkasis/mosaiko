/**
 * Validation for the public contact-form submission payload.
 *
 * Mirrors `business-settings-validation.ts`: manual, trim-everything,
 * max-length, no zod. Unlike the admin validator, contact fields are
 * REQUIRED (a contact message with no body is meaningless), so blank values
 * are rejected. `website` is a honeypot — the caller treats a non-empty
 * value as a bot and silently drops the request; it is not part of the
 * stored value.
 *
 * Returns a discriminated result instead of throwing, so the route can map
 * `{ ok: false }` straight to a 400 without try/catch.
 */

export interface ContactSubmissionValue {
  name: string;
  email: string;
  subject: string;
  message: string;
}

export interface ContactValidationIssue {
  field: string;
  message: string;
}

export type ContactValidationResult =
  | { ok: true; value: ContactSubmissionValue }
  | { ok: false; issues: ContactValidationIssue[] };

export const CONTACT_BOUNDS = {
  name: { min: 1, max: 80 },
  email: { min: 1, max: 254 },
  subject: { min: 1, max: 120 },
  message: { min: 10, max: 2000 },
} as const;

// Same permissive check used by business-settings-validation — good enough to
// catch typos without rejecting valid-but-exotic addresses.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Trim + length-bound a required string field, pushing any issue. */
function normalizeRequired(
  raw: unknown,
  field: keyof typeof CONTACT_BOUNDS,
  issues: ContactValidationIssue[],
): string {
  const { min, max } = CONTACT_BOUNDS[field];
  if (typeof raw !== 'string') {
    issues.push({ field, message: 'Debe ser una cadena.' });
    return '';
  }
  const trimmed = raw.trim();
  if (trimmed.length < min) {
    issues.push({
      field,
      message:
        min === 1
          ? 'Este campo es obligatorio.'
          : `Debe tener al menos ${min} caracteres.`,
    });
    return '';
  }
  if (trimmed.length > max) {
    issues.push({ field, message: `Excede el máximo de ${max} caracteres.` });
    return '';
  }
  return trimmed;
}

/**
 * Parses + validates a raw contact-form body. Collects ALL issues before
 * returning so the form can show every problem at once. Does NOT inspect the
 * `website` honeypot — that is the route's concern (a bot fill must look like
 * a success to the client, not a validation error).
 */
export function validateContactSubmission(
  raw: unknown,
): ContactValidationResult {
  if (!isPlainObject(raw)) {
    return {
      ok: false,
      issues: [{ field: '<root>', message: 'El cuerpo debe ser un objeto.' }],
    };
  }

  const issues: ContactValidationIssue[] = [];
  const name = normalizeRequired(raw.name, 'name', issues);
  const email = normalizeRequired(raw.email, 'email', issues);
  const subject = normalizeRequired(raw.subject, 'subject', issues);
  const message = normalizeRequired(raw.message, 'message', issues);

  if (email !== '' && !EMAIL_RE.test(email)) {
    issues.push({ field: 'email', message: 'Correo no válido.' });
  }

  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, value: { name, email, subject, message } };
}
