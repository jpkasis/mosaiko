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

const inputBase =
  'w-28 rounded-lg border bg-white py-2 pl-7 pr-2 text-sm text-charcoal disabled:cursor-not-allowed disabled:bg-light-gray/20 disabled:text-warm-gray focus:outline-none focus:ring-1';
const inputOk =
  'border-light-gray focus:border-terracotta focus:ring-terracotta/30';
const inputBad = 'border-error focus:border-error focus:ring-error/30';

function sizeLabel(n: number): string {
  return `${n} ${n === 1 ? 'pieza' : 'piezas'}`;
}

/** Parse an admin price field: whole pesos only (1–100000), else null. */
function parsePrice(s: string | undefined): number | null {
  if (s == null) return null;
  const t = s.trim();
  if (!/^\d+$/.test(t)) return null;
  const n = Number(t);
  return Number.isInteger(n) && n >= 1 && n <= 100000 ? n : null;
}

/** Plain-language guide shown at the top of the page for the (non-technical)
 *  client. Kept short and concrete — these are the only things they need. */
const HELP_POINTS: string[] = [
  'Este es el único lugar para cambiar los precios. Lo que escribes aquí es lo que el cliente VE y lo que PAGA — siempre coinciden.',
  'Cada categoría tiene su propio precio por tamaño (por ejemplo, Spotify de 6 piezas puede costar más que Mosaicos de 6 piezas).',
  'El precio de “1 pieza” (un solo imán) lo defines tú libremente, igual que los demás — ponle el precio que quieras.',
  'Escribe el nuevo precio en pesos enteros (sin centavos) y presiona “Guardar cambios”. La tienda se actualiza en menos de 1 minuto.',
  'Si lo prefieres, también puedes editar estos precios directamente en Shopify — es exactamente el mismo dato.',
];

export function PreciosContent() {
  const [rows, setRows] = useState<PriceRow[]>([]);
  // Drafts are STRINGS (Codex audit): an empty/invalid field stays empty/invalid
  // and disables Save, instead of silently becoming 0/NaN and relying on the API.
  const [draft, setDraft] = useState<Record<string, string>>({});
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
      setDraft(
        Object.fromEntries(data.rows.map((r) => [`${r.category}:${r.gridSize}`, String(r.price)])),
      );
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

  // Per-row validity of the current draft (only meaningful for edited rows).
  const invalidKeys = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) {
      if (!r.editable) continue;
      const key = `${r.category}:${r.gridSize}`;
      const raw = draft[key];
      if (raw === undefined || raw === String(r.price)) continue; // untouched
      if (parsePrice(raw) == null) set.add(key);
    }
    return set;
  }, [rows, draft]);

  const changed = useMemo(
    () =>
      rows.filter((r) => {
        if (!r.editable) return false;
        const parsed = parsePrice(draft[`${r.category}:${r.gridSize}`]);
        return parsed != null && parsed !== r.price;
      }),
    [rows, draft],
  );

  const canSave = migrated && !saving && changed.length > 0 && invalidKeys.size === 0;

  async function save() {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      const updates = changed.map((r) => ({
        category: r.category,
        gridSize: r.gridSize,
        price: parsePrice(draft[`${r.category}:${r.gridSize}`]),
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
      <div className="mb-5">
        <h1 className="font-serif text-2xl font-bold text-charcoal">Precios</h1>
        <p className="mt-1 text-sm text-warm-gray">
          El único lugar para cambiar los precios. Lo que ves aquí es lo que el cliente paga.
        </p>
      </div>

      {/* Plain-language instructions for the client. Open by default the first
          time; collapsible once they know the ropes. */}
      <details
        open
        className="mb-6 rounded-xl border border-marigold/40 bg-marigold/10 px-5 py-4"
      >
        <summary className="cursor-pointer select-none text-sm font-semibold text-charcoal">
          ¿Cómo funcionan los precios?
        </summary>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-relaxed text-charcoal/90">
          {HELP_POINTS.map((point) => (
            <li key={point}>{point}</li>
          ))}
        </ul>
      </details>

      {!migrated && !loading && (
        <div className="mb-5 rounded-lg border border-marigold/40 bg-marigold/10 px-4 py-3 text-sm text-charcoal">
          Los precios todavía no están conectados a Shopify. Se muestran los valores actuales,
          pero la edición se habilitará cuando se complete la migración de precios.
        </div>
      )}

      {error && (
        <div
          role="alert"
          aria-live="assertive"
          className="mb-5 rounded-lg border border-error/30 bg-error/5 px-4 py-3 text-sm text-error"
        >
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
                  const invalid = invalidKeys.has(key);
                  return (
                    <div key={key} className="flex items-start justify-between gap-4">
                      <label htmlFor={`price-${key}`} className="pt-2 text-sm text-charcoal">
                        {sizeLabel(r.gridSize)}
                      </label>
                      <div className="flex flex-col items-end">
                        <div className="relative">
                          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-warm-gray">
                            $
                          </span>
                          <input
                            id={`price-${key}`}
                            type="text"
                            inputMode="numeric"
                            disabled={!r.editable || saving}
                            aria-invalid={invalid}
                            aria-describedby={invalid ? `err-${key}` : undefined}
                            value={draft[key] ?? ''}
                            onChange={(e) =>
                              setDraft((d) => ({
                                ...d,
                                [key]: e.target.value.replace(/[^\d]/g, '').slice(0, 6),
                              }))
                            }
                            className={`${inputBase} ${invalid ? inputBad : inputOk}`}
                          />
                        </div>
                        {invalid && (
                          <span id={`err-${key}`} className="mt-1 text-xs text-error">
                            Usa pesos enteros (mín. $1).
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}

          <div className="sticky bottom-0 flex items-center justify-between gap-4 border-t border-light-gray bg-cream/95 py-4 backdrop-blur-sm">
            <span aria-live="polite" className="text-sm text-warm-gray">
              {invalidKeys.size > 0
                ? 'Corrige los precios marcados en rojo'
                : changed.length > 0
                  ? `${changed.length} cambio${changed.length > 1 ? 's' : ''} sin guardar`
                  : savedAt
                    ? 'Guardado ✓ · se refleja en la tienda en ~1 min'
                    : 'Sin cambios'}
            </span>
            <button
              type="button"
              onClick={save}
              disabled={!canSave}
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
