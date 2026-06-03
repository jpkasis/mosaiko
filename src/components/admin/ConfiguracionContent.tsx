'use client';

import { useState, useCallback } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { ContenidoPanel } from '@/components/admin/configuracion/ContenidoPanel';
import { NegocioPanel } from '@/components/admin/configuracion/NegocioPanel';
import { CuentaForm } from '@/components/admin/configuracion/CuentaForm';
import { HOME_COPY_MAP } from '@/lib/site-content';

type CopyPath = keyof typeof HOME_COPY_MAP;
type Fallbacks = Partial<Record<CopyPath, string>>;

export type ConfiguracionTab = 'contenido' | 'negocio' | 'cuenta';

const TABS: Array<{ id: ConfiguracionTab; label: string }> = [
  { id: 'contenido', label: 'Contenido' },
  { id: 'negocio', label: 'Negocio' },
  { id: 'cuenta', label: 'Cuenta' },
];

function isTab(v: string | null): v is ConfiguracionTab {
  return v === 'contenido' || v === 'negocio' || v === 'cuenta';
}

interface ConfiguracionContentProps {
  fallbacks: { es: Fallbacks; en: Fallbacks };
  initialTab?: ConfiguracionTab;
}

/**
 * Configuración tab shell. Tab state is URL-backed via `?tab=` so deep links
 * + refresh preserve the active tab. Default `contenido` keeps PR3 behavior
 * (visiting /admin/configuracion with no query lands on Contenido).
 */
export function ConfiguracionContent({
  fallbacks,
  initialTab = 'contenido',
}: ConfiguracionContentProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const urlTab = searchParams.get('tab');
  const [tab, setTab] = useState<ConfiguracionTab>(
    isTab(urlTab) ? urlTab : initialTab,
  );

  const selectTab = useCallback(
    (next: ConfiguracionTab) => {
      setTab(next);
      const params = new URLSearchParams(searchParams.toString());
      params.set('tab', next);
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [router, pathname, searchParams],
  );

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      {/* Tab nav */}
      <div
        role="tablist"
        aria-label="Secciones de configuración"
        className="flex gap-1 border-b border-light-gray"
      >
        {TABS.map(({ id, label }) => {
          const active = tab === id;
          return (
            <button
              key={id}
              role="tab"
              aria-selected={active}
              onClick={() => selectTab(id)}
              className={`-mb-px border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
                active
                  ? 'border-terracotta text-terracotta'
                  : 'border-transparent text-warm-gray hover:text-charcoal'
              }`}
            >
              {label}
            </button>
          );
        })}
      </div>

      {/* Active panel */}
      {tab === 'contenido' && <ContenidoPanel fallbacks={fallbacks} />}
      {tab === 'negocio' && <NegocioPanel />}
      {tab === 'cuenta' && <CuentaForm />}
    </div>
  );
}
