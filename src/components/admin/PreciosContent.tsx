'use client';

/**
 * PR-B — admin price editor. Dead-simple per the client's hard constraint:
 * one list grouped by category, edit a price (whole pesos), Save. Writes to
 * Shopify variant prices via PUT /api/admin/precios (the single source of
 * truth) — no GIDs or Shopify jargon exposed.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CategoryType } from '@/lib/customization-types';

interface PriceRow {
  category: CategoryType;
  categoryLabel: string;
  gridSize: number;
  price: number;
  editable: boolean;
}

const inputClass =
  'w-28 rounded-lg border border-light-gray bg-white py-2 pl-7 pr-2 text-sm text-charcoal disabled:cursor-not-allowed disabled:bg-light-gray/20 disabled:text-warm-gray focus:border-terracotta focus:outline-none focus:ring-1 focus:ring-terracotta/30';

function sizeLabel(n: number): string {
  return `${n} ${n === 1 ? 'pieza' : 'piezas'}`;
}

export function PreciosContent() {
  const [rows, setRows] = useState<PriceRow[]>([]);
  const [draft, setDraft] = useState<Record<string, number>>({});
  const [migrated, setMigrated] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/precios', { cache: 'no-store' });
      if (!res.ok) throw new Error('No se pudieron cargar los precios.');
      const data = (await res.json()) as { migrated: boolean; rows: PriceRow[] };
      setRows(data.rows);
      setMigrated(data.migrated);
      setDraft(Object.fromEntries(data.rows.map((r) => [`${r.category}:${r.gridSize}`, r.price])));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al cargar.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const byCategory = useMemo(() => {
    const groups = new Map<string, PriceRow[]>();
    for (const r of rows) {
      const list = groups.get(r.categoryLabel) ?? [];
      list.push(r);
      groups.set(r.categoryLabel, list);
    }
    for (const list of groups.values()) list.sort((a, b) => a.gridSize - b.gridSize);
    return Array.from(groups.entries());
  }, [rows]);

  const changed = useMemo(
    () =>
      rows.filter((r) => {
        const v = draft[`${r.category}:${r.gridSize}`];
        return Number.isInteger(v) && v !== r.price;
      }),
    [rows, draft],
  );

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const updates = changed.map((r) => ({
        category: r.category,
        gridSize: r.gridSize,
        price: draft[`${r.category}:${r.gridSize}`],
      }));
      const res = await fetch('/api/admin/precios', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ updates }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error?.message ?? 'No se pudieron guardar los precios.');
      setSavedAt(Date.now());
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al guardar.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6">
        <h1 className="font-serif text-2xl font-bold text-charcoal">Precios</h1>
        <p className="mt-1 text-sm text-warm-gray">
          Edita el precio de cada tipo de mosaico. Los cambios se guardan en Shopify y se
          reflejan en la tienda al instante.
        </p>
      </div>

      {!migrated && !loading && (
        <div className="mb-5 rounded-lg border border-marigold/40 bg-marigold/10 px-4 py-3 text-sm text-charcoal">
          Los precios todavía no están conectados a Shopify. Se muestran los valores actuales,
          pero la edición se habilitará cuando se complete la migración de precios.
        </div>
      )}

      {error && (
        <div className="mb-5 rounded-lg border border-error/30 bg-error/5 px-4 py-3 text-sm text-error">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-warm-gray">Cargando precios…</p>
      ) : (
        <div className="space-y-5">
          {byCategory.map(([label, list]) => (
            <div key={label} className="rounded-xl border border-light-gray bg-white p-5">
              <h2 className="mb-3 font-serif text-lg font-semibold text-charcoal">{label}</h2>
              <div className="flex flex-col gap-3">
                {list.map((r) => {
                  const key = `${r.category}:${r.gridSize}`;
                  return (
                    <div key={key} className="flex items-center justify-between gap-4">
                      <label htmlFor={`price-${key}`} className="text-sm text-charcoal">
                        {sizeLabel(r.gridSize)}
                      </label>
                      <div className="relative">
                        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-warm-gray">
                          $
                        </span>
                        <input
                          id={`price-${key}`}
                          type="number"
                          inputMode="numeric"
                          min={1}
                          step={1}
                          disabled={!r.editable || saving}
                          value={draft[key] ?? ''}
                          onChange={(e) =>
                            setDraft((d) => ({ ...d, [key]: Math.trunc(Number(e.target.value)) }))
                          }
                          className={inputClass}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}

          <div className="sticky bottom-0 flex items-center justify-between gap-4 border-t border-light-gray bg-cream/95 py-4 backdrop-blur-sm">
            <span className="text-sm text-warm-gray">
              {changed.length > 0
                ? `${changed.length} cambio${changed.length > 1 ? 's' : ''} sin guardar`
                : savedAt
                  ? 'Guardado ✓'
                  : 'Sin cambios'}
            </span>
            <button
              type="button"
              onClick={save}
              disabled={saving || changed.length === 0 || !migrated}
              className="min-h-[44px] rounded-xl bg-terracotta px-6 text-sm font-semibold text-white transition-colors hover:bg-terracotta-dark disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? 'Guardando…' : 'Guardar cambios'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
