'use client';

import type {
  AdminBusinessSettings,
  LocalizedValue,
} from '@/lib/admin/business-settings-validation';
import { BUSINESS_MAX_LENGTHS } from '@/lib/admin/business-settings-validation';

type LocalizedField = 'businessName' | 'footerCopy';
type NeutralField =
  | 'address'
  | 'phone'
  | 'whatsapp'
  | 'whatsappMessage'
  | 'instagramUrl'
  | 'facebookUrl'
  | 'notificationEmail';

interface NegocioFormProps {
  settings: AdminBusinessSettings;
  onChangeLocalized: (field: LocalizedField, locale: 'es' | 'en', value: string) => void;
  onChangeNeutral: (field: NeutralField, value: string) => void;
  onSave: () => void;
  saving: boolean;
  enDisabled?: boolean;
}

const inputClass =
  'w-full rounded-lg border border-light-gray bg-white px-3 py-2 text-sm text-charcoal placeholder:text-warm-gray/60 disabled:cursor-not-allowed disabled:bg-light-gray/20 disabled:text-warm-gray focus:border-terracotta focus:outline-none focus:ring-1 focus:ring-terracotta/30';

function LocalizedRow({
  label,
  field,
  value,
  long,
  enDisabled,
  onChange,
}: {
  label: string;
  field: LocalizedField;
  value: LocalizedValue;
  long: boolean;
  enDisabled?: boolean;
  onChange: NegocioFormProps['onChangeLocalized'];
}) {
  const max = BUSINESS_MAX_LENGTHS[field];
  return (
    <div className="space-y-2">
      <div className="text-sm font-medium text-charcoal">{label}</div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {(['es', 'en'] as const).map((locale) => {
          const disabled = locale === 'en' && enDisabled;
          const id = `business-${field}-${locale}`;
          return (
            <div key={locale} className="flex flex-col gap-1.5">
              <label
                htmlFor={id}
                className="text-xs font-semibold uppercase tracking-wide text-warm-gray"
              >
                {locale === 'es' ? 'Español' : 'English'}
              </label>
              {long ? (
                <textarea
                  id={id}
                  rows={3}
                  maxLength={max}
                  disabled={disabled}
                  value={value[locale]}
                  onChange={(e) => onChange(field, locale, e.target.value)}
                  className={`resize-y ${inputClass}`}
                />
              ) : (
                <input
                  id={id}
                  type="text"
                  maxLength={max}
                  disabled={disabled}
                  value={value[locale]}
                  onChange={(e) => onChange(field, locale, e.target.value)}
                  className={inputClass}
                />
              )}
              <p className="text-[10px] text-warm-gray/70">
                {value[locale].length}/{max}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function NeutralRow({
  label,
  field,
  value,
  type = 'text',
  placeholder,
  long = false,
  helpText,
  onChange,
}: {
  label: string;
  field: NeutralField;
  value: string;
  type?: string;
  placeholder?: string;
  long?: boolean;
  helpText?: string;
  onChange: NegocioFormProps['onChangeNeutral'];
}) {
  const id = `business-${field}`;
  const max = BUSINESS_MAX_LENGTHS[field];
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-charcoal">
        {label}
      </label>
      {long ? (
        <textarea
          id={id}
          rows={3}
          maxLength={max}
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(field, e.target.value)}
          className={`resize-y ${inputClass}`}
        />
      ) : (
        <input
          id={id}
          type={type}
          maxLength={max}
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(field, e.target.value)}
          className={inputClass}
        />
      )}
      {helpText && <p className="text-xs text-warm-gray/70">{helpText}</p>}
    </div>
  );
}

export function NegocioForm({
  settings,
  onChangeLocalized,
  onChangeNeutral,
  onSave,
  saving,
  enDisabled,
}: NegocioFormProps) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSave();
      }}
      className="space-y-6"
    >
      <fieldset className="rounded-xl border border-light-gray bg-white p-5">
        <legend
          className="px-2 text-base font-semibold text-charcoal"
          style={{ fontFamily: 'var(--font-cormorant), Georgia, serif' }}
        >
          Identidad
        </legend>
        <div className="mt-2 space-y-5">
          <LocalizedRow
            label="Nombre del negocio"
            field="businessName"
            value={settings.businessName}
            long={false}
            enDisabled={enDisabled}
            onChange={onChangeLocalized}
          />
          <LocalizedRow
            label="Texto del pie de página"
            field="footerCopy"
            value={settings.footerCopy}
            long
            enDisabled={enDisabled}
            onChange={onChangeLocalized}
          />
        </div>
      </fieldset>

      <fieldset className="rounded-xl border border-light-gray bg-white p-5">
        <legend
          className="px-2 text-base font-semibold text-charcoal"
          style={{ fontFamily: 'var(--font-cormorant), Georgia, serif' }}
        >
          Contacto
        </legend>
        <div className="mt-2 grid grid-cols-1 gap-5 md:grid-cols-2">
          <NeutralRow label="Dirección" field="address" value={settings.address} onChange={onChangeNeutral} />
          <NeutralRow label="Teléfono" field="phone" value={settings.phone} onChange={onChangeNeutral} />
          <NeutralRow
            label="WhatsApp"
            field="whatsapp"
            value={settings.whatsapp}
            placeholder="+52 1 55 1234 5678"
            onChange={onChangeNeutral}
          />
          <NeutralRow
            label="Correo de notificaciones"
            field="notificationEmail"
            value={settings.notificationEmail}
            type="email"
            placeholder="pedidos@minegocio.com"
            onChange={onChangeNeutral}
          />
          <div className="md:col-span-2">
            <NeutralRow
              label="Mensaje de WhatsApp (texto pre-cargado)"
              field="whatsappMessage"
              value={settings.whatsappMessage}
              placeholder="Hola, me interesan los imanes personalizados de Mosaiko…"
              long
              helpText="Se carga automáticamente en el chat cuando un cliente abre WhatsApp desde la página de contacto."
              onChange={onChangeNeutral}
            />
          </div>
        </div>
      </fieldset>

      <fieldset className="rounded-xl border border-light-gray bg-white p-5">
        <legend
          className="px-2 text-base font-semibold text-charcoal"
          style={{ fontFamily: 'var(--font-cormorant), Georgia, serif' }}
        >
          Redes sociales
        </legend>
        <div className="mt-2 grid grid-cols-1 gap-5 md:grid-cols-2">
          <NeutralRow
            label="Instagram (URL)"
            field="instagramUrl"
            value={settings.instagramUrl}
            placeholder="https://instagram.com/minegocio"
            onChange={onChangeNeutral}
          />
          <NeutralRow
            label="Facebook (URL)"
            field="facebookUrl"
            value={settings.facebookUrl}
            placeholder="https://facebook.com/minegocio"
            onChange={onChangeNeutral}
          />
        </div>
      </fieldset>

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
