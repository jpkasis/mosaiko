'use client';

import { useEffect, useState, useCallback } from 'react';
import { ContenidoForm } from '@/components/admin/configuracion/ContenidoForm';
import type { ContenidoBody } from '@/lib/admin/site-copy-validation';
import { HOME_COPY_MAP } from '@/lib/site-content';

type CopyPath = keyof typeof HOME_COPY_MAP;
type Fallbacks = Partial<Record<CopyPath, string>>;

interface ConfiguracionContentProps {
  fallbacks: { es: Fallbacks; en: Fallbacks };
}

interface ContenidoApiResponse {
  content: ContenidoBody;
  error?: string;
  translationStatus?: {
    en: {
      available: boolean;
      message?: string;
    };
  };
}

const EMPTY_CONTENT: ContenidoBody = { es: {}, en: {} };

export function ConfiguracionContent({ fallbacks }: ConfiguracionContentProps) {
  const [content, setContent] = useState<ContenidoBody>(EMPTY_CONTENT);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<
    | { kind: 'idle' }
    | { kind: 'success' }
    | { kind: 'error'; message: string }
  >({ kind: 'idle' });
  const [translationStatus, setTranslationStatus] = useState<
    ContenidoApiResponse['translationStatus']
  >();

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setLoadError(null);
      try {
        const res = await fetch('/api/admin/configuracion/contenido', {
          cache: 'no-store',
        });
        const data = (await res.json()) as ContenidoApiResponse;
        if (cancelled) return;
        if (!res.ok) {
          setLoadError(data.error ?? 'No se pudo cargar el contenido.');
          return;
        }
        setContent(data.content);
        setTranslationStatus(data.translationStatus);
      } catch (error) {
        if (cancelled) return;
        console.error('[ConfiguracionContent] load failed:', error);
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

  const handleChange = useCallback(
    (locale: 'es' | 'en', path: CopyPath, value: string) => {
      setContent((prev) => ({
        ...prev,
        [locale]: { ...prev[locale], [path]: value },
      }));
      // Clear any prior save status — the form is now dirty again
      setSaveStatus({ kind: 'idle' });
    },
    [],
  );

  const handleSave = useCallback(async () => {
    setSaving(true);
    setSaveStatus({ kind: 'idle' });
    try {
      const res = await fetch('/api/admin/configuracion/contenido', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(content),
      });
      const data = (await res.json()) as ContenidoApiResponse;
      if (!res.ok) {
        setSaveStatus({
          kind: 'error',
          message: data.error ?? 'No se pudo guardar el contenido.',
        });
        return;
      }
      setContent(data.content);
      setSaveStatus({ kind: 'success' });
    } catch (error) {
      console.error('[ConfiguracionContent] save failed:', error);
      setSaveStatus({
        kind: 'error',
        message: 'Error de red. Intenta de nuevo.',
      });
    } finally {
      setSaving(false);
    }
  }, [content]);

  if (loading) {
    return (
      <div className="rounded-xl border border-light-gray bg-white p-8 text-center text-sm text-warm-gray">
        Cargando contenido…
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
    <div className="mx-auto max-w-5xl space-y-6">
      <header className="space-y-1">
        <h2
          className="text-2xl font-semibold text-charcoal"
          style={{ fontFamily: 'var(--font-cormorant), Georgia, serif' }}
        >
          Contenido del sitio
        </h2>
        <p className="text-sm text-warm-gray">
          Edita el texto que aparece en la página principal. Los campos vacíos
          mostrarán el texto predeterminado del sitio (visible como
          marcador en cada campo).
        </p>
      </header>

      {saveStatus.kind === 'success' && (
        <div
          role="status"
          className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700"
        >
          Contenido guardado.
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
      {translationStatus?.en.available === false && (
        <div
          role="status"
          className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800"
        >
          {translationStatus.en.message ??
            'La edición en inglés no está disponible en este momento.'}
        </div>
      )}

      <ContenidoForm
        content={content}
        fallbacks={fallbacks}
        onChange={handleChange}
        onSave={handleSave}
        saving={saving}
        enDisabled={translationStatus?.en.available === false}
      />
    </div>
  );
}
