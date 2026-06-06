/**
 * Validation for the admin Configuración → Negocio save payload (UAT-6 PR4).
 *
 * Shape: localized fields (businessName, footerCopy) carry `{ es, en }`;
 * neutral fields are single strings. The validator trims everything,
 * enforces max lengths, normalizes URLs to https (or rejects), validates
 * the optional email, and normalizes WhatsApp to digits. Blank neutral
 * values are allowed (they clear the field → public read falls back to
 * hidden/empty).
 */

export interface LocalizedValue {
  es: string;
  en: string;
}

export interface AdminBusinessSettings {
  businessName: LocalizedValue;
  footerCopy: LocalizedValue;
  address: string;
  phone: string;
  whatsapp: string;
  whatsappMessage: string;
  instagramUrl: string;
  facebookUrl: string;
  tiktokUrl: string;
  imageRetentionDays: number;
}

export const RETENTION_DEFAULT = 45;
export const RETENTION_DISABLED = 0;
export const RETENTION_MIN = 7;
export const RETENTION_MAX = 365;

export const BUSINESS_MAX_LENGTHS = {
  businessName: 120,
  footerCopy: 500,
  address: 300,
  phone: 40,
  whatsapp: 40,
  whatsappMessage: 300,
  instagramUrl: 300,
  facebookUrl: 300,
  tiktokUrl: 300,
} as const;

export interface BusinessValidationIssue {
  field: string;
  message: string;
}

export class BusinessSettingsValidationError extends Error {
  readonly issues: BusinessValidationIssue[];
  constructor(issues: BusinessValidationIssue[]) {
    super(`Validación falló: ${issues.length} problema(s)`);
    this.name = 'BusinessSettingsValidationError';
    this.issues = issues;
  }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function normalizeLocalized(
  raw: unknown,
  field: string,
  max: number,
  issues: BusinessValidationIssue[],
): LocalizedValue {
  const out: LocalizedValue = { es: '', en: '' };
  if (raw === undefined) return out;
  if (!isPlainObject(raw)) {
    issues.push({ field, message: `${field} debe ser un objeto { es, en }.` });
    return out;
  }
  for (const locale of ['es', 'en'] as const) {
    const v = raw[locale];
    if (v === undefined) continue;
    if (typeof v !== 'string') {
      issues.push({ field: `${field}.${locale}`, message: 'Debe ser una cadena.' });
      continue;
    }
    const trimmed = v.trim();
    if (trimmed.length > max) {
      issues.push({
        field: `${field}.${locale}`,
        message: `Excede el máximo de ${max} caracteres.`,
      });
      continue;
    }
    out[locale] = trimmed;
  }
  return out;
}

function normalizeNeutral(
  raw: unknown,
  field: keyof typeof BUSINESS_MAX_LENGTHS,
  issues: BusinessValidationIssue[],
): string {
  if (raw === undefined) return '';
  if (typeof raw !== 'string') {
    issues.push({ field, message: 'Debe ser una cadena.' });
    return '';
  }
  const trimmed = raw.trim();
  if (trimmed.length > BUSINESS_MAX_LENGTHS[field]) {
    issues.push({
      field,
      message: `Excede el máximo de ${BUSINESS_MAX_LENGTHS[field]} caracteres.`,
    });
    return '';
  }
  return trimmed;
}

function normalizeUrl(
  raw: string,
  field: string,
  issues: BusinessValidationIssue[],
): string {
  if (raw === '') return '';
  let candidate = raw;
  if (!/^https?:\/\//i.test(candidate)) candidate = `https://${candidate}`;
  try {
    const url = new URL(candidate);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      issues.push({ field, message: 'URL no válida.' });
      return '';
    }
    // Force https.
    url.protocol = 'https:';
    return url.toString();
  } catch {
    issues.push({ field, message: 'URL no válida.' });
    return '';
  }
}

function normalizeWhatsapp(raw: string): string {
  if (raw === '') return '';
  // Keep a leading + and digits only; strip spaces, dashes, parens.
  const hasPlus = raw.trim().startsWith('+');
  const digits = raw.replace(/[^\d]/g, '');
  return hasPlus ? `+${digits}` : digits;
}

function normalizeRetentionDays(
  raw: unknown,
  issues: BusinessValidationIssue[],
): number {
  if (raw === undefined || raw === null) return RETENTION_DEFAULT;
  if (typeof raw === 'string' && raw.trim() === '') return RETENTION_DEFAULT;
  if (typeof raw !== 'number' && typeof raw !== 'string') {
    issues.push({
      field: 'imageRetentionDays',
      message: `Debe ser 0 o un entero entre ${RETENTION_MIN} y ${RETENTION_MAX} días.`,
    });
    return RETENTION_DEFAULT;
  }

  const n = Number(raw);
  if (
    !Number.isInteger(n) ||
    n < RETENTION_DISABLED ||
    (n > RETENTION_DISABLED && n < RETENTION_MIN) ||
    n > RETENTION_MAX
  ) {
    issues.push({
      field: 'imageRetentionDays',
      message: `Debe ser 0 o un entero entre ${RETENTION_MIN} y ${RETENTION_MAX} días.`,
    });
    return RETENTION_DEFAULT;
  }

  return n;
}

/**
 * Parses + normalizes + validates a Negocio PUT body. Collects ALL issues
 * before throwing so the admin form can show every problem at once.
 */
export function validateBusinessSettings(body: unknown): AdminBusinessSettings {
  if (!isPlainObject(body)) {
    throw new BusinessSettingsValidationError([
      { field: '<root>', message: 'El cuerpo debe ser un objeto.' },
    ]);
  }
  const settings = body.settings;
  if (!isPlainObject(settings)) {
    throw new BusinessSettingsValidationError([
      { field: 'settings', message: 'Falta el objeto settings.' },
    ]);
  }

  const issues: BusinessValidationIssue[] = [];

  const businessName = normalizeLocalized(
    settings.businessName,
    'businessName',
    BUSINESS_MAX_LENGTHS.businessName,
    issues,
  );
  const footerCopy = normalizeLocalized(
    settings.footerCopy,
    'footerCopy',
    BUSINESS_MAX_LENGTHS.footerCopy,
    issues,
  );
  const address = normalizeNeutral(settings.address, 'address', issues);
  const phone = normalizeNeutral(settings.phone, 'phone', issues);
  const whatsappRaw = normalizeNeutral(settings.whatsapp, 'whatsapp', issues);
  const whatsappMessage = normalizeNeutral(
    settings.whatsappMessage,
    'whatsappMessage',
    issues,
  );
  const instagramRaw = normalizeNeutral(settings.instagramUrl, 'instagramUrl', issues);
  const facebookRaw = normalizeNeutral(settings.facebookUrl, 'facebookUrl', issues);
  const tiktokRaw = normalizeNeutral(settings.tiktokUrl, 'tiktokUrl', issues);
  const imageRetentionDays = normalizeRetentionDays(
    settings.imageRetentionDays,
    issues,
  );

  const instagramUrl = normalizeUrl(instagramRaw, 'instagramUrl', issues);
  const facebookUrl = normalizeUrl(facebookRaw, 'facebookUrl', issues);
  const tiktokUrl = normalizeUrl(tiktokRaw, 'tiktokUrl', issues);
  const whatsapp = normalizeWhatsapp(whatsappRaw);

  if (issues.length > 0) {
    throw new BusinessSettingsValidationError(issues);
  }

  return {
    businessName,
    footerCopy,
    address,
    phone,
    whatsapp,
    whatsappMessage,
    instagramUrl,
    facebookUrl,
    tiktokUrl,
    imageRetentionDays,
  };
}
