'use client';

import { useEffect, useState, useCallback } from 'react';
import { NegocioForm } from '@/components/admin/configuracion/NegocioForm';
import type { AdminBusinessSettings } from '@/lib/admin/business-settings-validation';

type LocalizedField = 'businessName' | 'footerCopy';
type NeutralField =
  | 'address'
  | 'phone'
  | 'whatsapp'
  | 'instagramUrl'
  | 'facebookUrl'
  | 'notificationEmail';

interface NegocioApiResponse {
  settings?: AdminBusinessSettings;
  ok?: boolean;
  error?: { code?: string; message?: string; issues?: Array<{ field: string; message: string }> };
}

const EMPTY: AdminBusinessSettings = {
  businessName: { es: '', en: '' },
  footerCopy: { es: '', en: '' },
  address: '',
  phone: '',
  whatsapp: '',
  instagramUrl: '',
  facebookUrl: '',
  notificationEmail: '',
};

/**
 * Negocio tab — edits the business-settings metaobject. Mirrors the PR3
 * panel pattern (load on mount, save via PUT, banners).
 */
export function NegocioPanel() {
  const [settings, setSettings] = useState<AdminBusinessSettings>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<
    | { kind: 'idle' }
    | { kind: 'success' }
    | { kind: 'error'; message: string }
  >({ kind: 'idle' });

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setLoadError(null);
      try {
        const res = await fetch('/api/admin/configuracion/negocio', {
          cache: 'no-store',
        });
        const data = (await res.json()) as NegocioApiResponse;
        if (cancelled) return;
        if (!res.ok || !data.settings) {
          setLoadError(data.error?.message ?? 'No se pudo cargar la información de negocio.');
          return;
        }
        setSettings(data.settings);
      } catch (error) {
        if (cancelled) return;
        console.error('[NegocioPanel] load failed:', error);
        setLoadError('Error de red. Intenta recargar la página.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleChangeLocalized = useCallback(
    (field: LocalizedField, locale: 'es' | 'en', value: string) => {
      setSettings((prev) => ({
        ...prev,
        [field]: { ...prev[field], [locale]: value },
      }));
      setSaveStatus({ kind: 'idle' });
    },
    [],
  );

  const handleChangeNeutral = useCallback((field: NeutralField, value: string) => {
    setSettings((prev) => ({ ...prev, [field]: value }));
    setSaveStatus({ kind: 'idle' });
  }, []);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setSaveStatus({ kind: 'idle' });
    try {
      const res = await fetch('/api/admin/configuracion/negocio', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings }),
      });
      const data = (await res.json()) as NegocioApiResponse;
      if (!res.ok) {
        const issueMsg = data.error?.issues?.[0]
          ? `${data.error.issues[0].field}: ${data.error.issues[0].message}`
          : undefined;
        setSaveStatus({
          kind: 'error',
          message: issueMsg ?? data.error?.message ?? 'No se pudo guardar.',
        });
        return;
      }
      if (data.settings) setSettings(data.settings);
      setSaveStatus({ kind: 'success' });
    } catch (error) {
      console.error('[NegocioPanel] save failed:', error);
      setSaveStatus({ kind: 'error', message: 'Error de red. Intenta de nuevo.' });
    } finally {
      setSaving(false);
    }
  }, [settings]);

  if (loading) {
    return (
      <div className="rounded-xl border border-light-gray bg-white p-8 text-center text-sm text-warm-gray">
        Cargando información de negocio…
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="rounded-xl border border-error/30 bg-error/5 p-6 text-sm text-error">
        {loadError}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h2
          className="text-2xl font-semibold text-charcoal"
          style={{ fontFamily: 'var(--font-cormorant), Georgia, serif' }}
        >
          Información de negocio
        </h2>
        <p className="text-sm text-warm-gray">
          Datos de contacto y redes sociales que aparecen en el pie de página y
          la página de contacto. Los campos vacíos se ocultan en el sitio.
        </p>
      </header>

      {saveStatus.kind === 'success' && (
        <div
          role="status"
          className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700"
        >
          Información guardada.
        </div>
      )}
      {saveStatus.kind === 'error' && (
        <div
          role="alert"
          className="rounded-lg border border-error/30 bg-error/5 px-4 py-3 text-sm text-error"
        >
          {saveStatus.message}
        </div>
      )}

      <NegocioForm
        settings={settings}
        onChangeLocalized={handleChangeLocalized}
        onChangeNeutral={handleChangeNeutral}
        onSave={handleSave}
        saving={saving}
      />
    </div>
  );
}
