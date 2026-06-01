/**
 * Validation for the admin Configuración → Contenido save payload.
 *
 * The save handler accepts `{ es: {...}, en: {...} }` where each locale's
 * value is a partial map keyed by next-intl paths from `HOME_COPY_MAP`.
 * The validator:
 *   - rejects unknown top-level locales (only 'es' + 'en')
 *   - rejects unknown nested keys (must exist in HOME_COPY_MAP)
 *   - rejects non-string values
 *   - enforces MAX_LENGTHS per key
 *   - trims values BEFORE measuring length and BEFORE returning
 *   - accepts empty strings (intentional clear → site-content falls back
 *     to static next-intl JSON)
 */
import { HOME_COPY_MAP, type SupportedLocale } from '@/lib/site-content';

export type CopyPath = keyof typeof HOME_COPY_MAP;

/**
 * Max length (characters, after trim) per UI key. Sized so the section
 * panels stay scannable in Spanish + English. Subtitles are larger
 * because some marketing copy is two sentences.
 */
export const MAX_LENGTHS: Record<CopyPath, number> = {
  'hero.badge': 120,
  'hero.cta': 120,
  'hero.ctaSecondary': 120,
  'hero.title': 160,
  'howItWorks.title': 160,
  'hero.subtitle': 500,
  'howItWorks.subtitle': 500,
};

export const ALLOWED_LOCALES: readonly SupportedLocale[] = ['es', 'en'] as const;

export type ContenidoLocaleMap = Partial<Record<CopyPath, string>>;

export interface ContenidoBody {
  es: ContenidoLocaleMap;
  en: ContenidoLocaleMap;
}

export interface ValidationIssue {
  locale?: string;
  path?: string;
  message: string;
}

export class ContenidoValidationError extends Error {
  readonly issues: ValidationIssue[];
  constructor(issues: ValidationIssue[]) {
    super(`Validación falló: ${issues.length} problema(s)`);
    this.name = 'ContenidoValidationError';
    this.issues = issues;
  }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isCopyPath(key: string): key is CopyPath {
  return Object.prototype.hasOwnProperty.call(HOME_COPY_MAP, key);
}

/**
 * Parses + trims + validates a PUT body for /api/admin/configuracion/contenido.
 * Throws `ContenidoValidationError` with all issues collected (don't bail
 * on the first one — the admin form can show every issue at once).
 *
 * Returns the normalized `{ es, en }` shape with trimmed strings.
 */
export function validateContenidoBody(body: unknown): ContenidoBody {
  const issues: ValidationIssue[] = [];

  if (!isPlainObject(body)) {
    throw new ContenidoValidationError([{ message: 'El cuerpo debe ser un objeto.' }]);
  }

  // Reject unknown top-level locales
  for (const k of Object.keys(body)) {
    if (!ALLOWED_LOCALES.includes(k as SupportedLocale)) {
      issues.push({ locale: k, message: `Locale no permitido: ${k}` });
    }
  }

  const out: ContenidoBody = { es: {}, en: {} };

  for (const locale of ALLOWED_LOCALES) {
    const localeBody = body[locale];
    if (localeBody === undefined) continue; // optional — partial saves OK
    if (!isPlainObject(localeBody)) {
      issues.push({
        locale,
        message: `El campo "${locale}" debe ser un objeto.`,
      });
      continue;
    }

    for (const [path, value] of Object.entries(localeBody)) {
      if (!isCopyPath(path)) {
        issues.push({
          locale,
          path,
          message: `Clave desconocida: ${path}`,
        });
        continue;
      }
      if (typeof value !== 'string') {
        issues.push({
          locale,
          path,
          message: `El valor debe ser una cadena.`,
        });
        continue;
      }
      const trimmed = value.trim();
      const max = MAX_LENGTHS[path];
      if (trimmed.length > max) {
        issues.push({
          locale,
          path,
          message: `Excede el máximo de ${max} caracteres (actual: ${trimmed.length}).`,
        });
        continue;
      }
      out[locale][path] = trimmed;
    }
  }

  if (issues.length > 0) {
    throw new ContenidoValidationError(issues);
  }
  return out;
}
