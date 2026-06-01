'use client';

import type { ContenidoBody } from '@/lib/admin/site-copy-validation';
import { HOME_COPY_MAP } from '@/lib/site-content';
import { MAX_LENGTHS } from '@/lib/admin/site-copy-validation';

type CopyPath = keyof typeof HOME_COPY_MAP;
type Fallbacks = Partial<Record<CopyPath, string>>;

interface ContenidoFormProps {
  content: ContenidoBody;
  fallbacks: { es: Fallbacks; en: Fallbacks };
  onChange: (locale: 'es' | 'en', path: CopyPath, value: string) => void;
  onSave: () => void;
  saving: boolean;
  enDisabled?: boolean;
}

/**
 * Sections + the fields they contain. Section labels are Spanish — admin
 * UI is Spanish-only per CLAUDE.md.
 */
const SECTIONS: Array<{ label: string; fields: Array<{ path: CopyPath; label: string; long: boolean }> }> = [
  {
    label: 'Hero',
    fields: [
      { path: 'hero.badge', label: 'Etiqueta', long: false },
      { path: 'hero.title', label: 'Título', long: false },
      { path: 'hero.subtitle', label: 'Subtítulo', long: true },
      { path: 'hero.cta', label: 'Botón principal', long: false },
      { path: 'hero.ctaSecondary', label: 'Botón secundario', long: false },
    ],
  },
  {
    label: 'Cómo funciona',
    fields: [
      { path: 'howItWorks.title', label: 'Título', long: false },
      { path: 'howItWorks.subtitle', label: 'Subtítulo', long: true },
    ],
  },
];

interface LocaleInputProps {
  locale: 'es' | 'en';
  localeLabel: string;
  path: CopyPath;
  value: string;
  fallback: string | undefined;
  long: boolean;
  disabled?: boolean;
  onChange: (locale: 'es' | 'en', path: CopyPath, value: string) => void;
}

function LocaleInput({
  locale,
  localeLabel,
  path,
  value,
  fallback,
  long,
  disabled = false,
  onChange,
}: LocaleInputProps) {
  const max = MAX_LENGTHS[path];
  const placeholder = fallback ?? '';
  const id = `${locale}-${path}`;
  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor={id}
        className="text-xs font-semibold uppercase tracking-wide text-warm-gray"
      >
        {localeLabel}
      </label>
      {long ? (
        <textarea
          id={id}
          value={value}
          placeholder={placeholder}
          maxLength={max}
          disabled={disabled}
          onChange={(e) => onChange(locale, path, e.target.value)}
          rows={3}
          className="w-full resize-y rounded-lg border border-light-gray bg-white px-3 py-2 text-sm text-charcoal placeholder:text-warm-gray/60 disabled:cursor-not-allowed disabled:bg-light-gray/20 disabled:text-warm-gray focus:border-terracotta focus:outline-none focus:ring-1 focus:ring-terracotta/30"
        />
      ) : (
        <input
          id={id}
          type="text"
          value={value}
          placeholder={placeholder}
          maxLength={max}
          disabled={disabled}
          onChange={(e) => onChange(locale, path, e.target.value)}
          className="w-full rounded-lg border border-light-gray bg-white px-3 py-2 text-sm text-charcoal placeholder:text-warm-gray/60 disabled:cursor-not-allowed disabled:bg-light-gray/20 disabled:text-warm-gray focus:border-terracotta focus:outline-none focus:ring-1 focus:ring-terracotta/30"
        />
      )}
      <p className="text-[10px] text-warm-gray/70">
        {value.length}/{max}
      </p>
    </div>
  );
}

export function ContenidoForm({
  content,
  fallbacks,
  onChange,
  onSave,
  saving,
  enDisabled = false,
}: ContenidoFormProps) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSave();
      }}
      className="space-y-6"
    >
      {SECTIONS.map((section) => (
        <fieldset
          key={section.label}
          className="rounded-xl border border-light-gray bg-white p-5"
        >
          <legend
            className="px-2 text-base font-semibold text-charcoal"
            style={{ fontFamily: 'var(--font-cormorant), Georgia, serif' }}
          >
            {section.label}
          </legend>
          <div className="mt-2 space-y-5">
            {section.fields.map(({ path, label, long }) => (
              <div key={path} className="space-y-2">
                <div className="text-sm font-medium text-charcoal">{label}</div>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <LocaleInput
                    locale="es"
                    localeLabel="Español"
                    path={path}
                    value={content.es[path] ?? ''}
                    fallback={fallbacks.es[path]}
                    long={long}
                    onChange={onChange}
                  />
                  <LocaleInput
                    locale="en"
                    localeLabel="English"
                    path={path}
                    value={content.en[path] ?? ''}
                    fallback={fallbacks.en[path]}
                    long={long}
                    disabled={enDisabled}
                    onChange={onChange}
                  />
                </div>
              </div>
            ))}
          </div>
        </fieldset>
      ))}

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={saving}
          className="rounded-lg bg-terracotta px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-terracotta/90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {saving ? 'Guardando…' : 'Guardar cambios'}
        </button>
      </div>
    </form>
  );
}
