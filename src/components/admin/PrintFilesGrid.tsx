'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';

interface TileDescriptor {
  index: number;
  key: string;
  publicUrl: string;
  downloadUrl: string;
}

interface LineDescriptor {
  lineItemId: number;
  jobId: string;
  tiles: TileDescriptor[];
}

interface PrintFilesResponse {
  orderId: string;
  status: 'complete';
  lines: LineDescriptor[];
}

// Phase 5 (Appendix I): admin print-files now status-gated. The route
// returns 200 only when print_pipeline_status === 'complete'; partial /
// failed / unknown_legacy → 409 + a retry CTA payload. The grid surfaces
// either the per-line tile thumbnails (happy path) or a banner with a
// "Reintentar" link to the existing retry endpoint.
interface BlockedResponse {
  status: 'partial' | 'failed' | 'unknown_legacy' | string;
  message: string;
  retryUrl: string;
}

interface PrintFilesGridProps {
  /** Shopify order ID (numeric, no `gid://` prefix). */
  orderId: string;
}

export function PrintFilesGrid({ orderId }: PrintFilesGridProps) {
  const [data, setData] = useState<PrintFilesResponse | null>(null);
  const [blocked, setBlocked] = useState<BlockedResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Codex Phase 5 audit MEDIUM fix: track retry-in-progress so the
  // button can be disabled, and a retry failure surfaces an inline
  // error instead of silently collapsing into the empty-state branch.
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchFiles() {
      try {
        const res = await fetch(`/api/admin/print-files?orderId=${encodeURIComponent(orderId)}`);
        if (res.status === 409) {
          const blockedData = (await res.json()) as BlockedResponse;
          setBlocked(blockedData);
          return;
        }
        if (!res.ok) {
          const errData = await res.json();
          setError(errData.error || 'Error al cargar archivos.');
          return;
        }
        const json = (await res.json()) as PrintFilesResponse;
        setData(json);
      } catch {
        setError('Error de conexión.');
      } finally {
        setIsLoading(false);
      }
    }
    fetchFiles();
  }, [orderId]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-light-gray border-t-terracotta" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg bg-cream p-4 text-center text-sm text-warm-gray">
        {error}
      </div>
    );
  }

  // Status-gated banner: order isn't complete, surface the retry CTA.
  if (blocked) {
    const label =
      blocked.status === 'partial'
        ? 'Pedido parcial'
        : blocked.status === 'failed'
          ? 'Pedido fallido'
          : 'Estado desconocido';
    return (
      <div
        className="rounded-lg p-4"
        style={{
          background: 'rgba(217, 119, 6, 0.08)',
          border: '1px solid rgba(217, 119, 6, 0.25)',
        }}
      >
        <div className="mb-2 text-sm font-semibold text-charcoal">{label}</div>
        <p className="text-sm text-warm-gray">{blocked.message}</p>
        <button
          type="button"
          disabled={retrying}
          onClick={async () => {
            // Codex Phase 5 audit MEDIUM fix: track POST + refetch
            // status so a failed retry surfaces inline. Pre-fix, a
            // retry-endpoint 5xx would fall through to the "no files"
            // empty branch without any explanation.
            setRetrying(true);
            setRetryError(null);
            try {
              const retryRes = await fetch(blocked.retryUrl, { method: 'POST' });
              if (!retryRes.ok) {
                const body = await retryRes.json().catch(() => ({}));
                setRetryError(
                  (body as { error?: string }).error ??
                    `Reintento falló (HTTP ${retryRes.status}).`,
                );
                return;
              }
              const res = await fetch(
                `/api/admin/print-files?orderId=${encodeURIComponent(orderId)}`,
              );
              if (res.status === 409) {
                setBlocked((await res.json()) as BlockedResponse);
                return;
              }
              if (res.ok) {
                setBlocked(null);
                setData((await res.json()) as PrintFilesResponse);
                return;
              }
              setRetryError(`Recarga falló (HTTP ${res.status}).`);
            } catch (e) {
              setRetryError(
                e instanceof Error ? e.message : 'Error de conexión durante el reintento.',
              );
            } finally {
              setRetrying(false);
            }
          }}
          className="mt-3 inline-flex items-center gap-1.5 rounded-md bg-terracotta px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-terracotta/90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {retrying ? 'Reintentando…' : 'Reintentar procesamiento'}
        </button>
        {retryError && (
          <p className="mt-2 text-xs text-error">{retryError}</p>
        )}
      </div>
    );
  }

  if (!data || data.lines.length === 0) {
    return (
      <div className="rounded-lg bg-cream p-6 text-center">
        <p className="text-sm text-warm-gray">
          Los archivos de impresión se generan automáticamente cuando llega un pedido.
        </p>
      </div>
    );
  }

  // Multi-line aware: each Shopify line item gets its own thumbnail
  // grid. Single-line orders look the same as before; multi-line orders
  // (rare but possible — bundle purchases) get a clear per-line breakdown.
  return (
    <div className="flex flex-col gap-6">
      {data.lines.map((line) => {
        const cols = line.tiles.length <= 4 ? 2 : 3;
        return (
          <div key={line.lineItemId}>
            {data.lines.length > 1 && (
              <div className="mb-2 text-xs font-medium text-warm-gray">
                Línea {line.lineItemId}
              </div>
            )}
            <div
              className="grid gap-2"
              style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}
            >
              {line.tiles.map((tile, index) => (
                <motion.div
                  key={tile.key}
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: index * 0.04 }}
                  className="group relative overflow-hidden rounded-lg"
                  style={{ border: '1px solid #e5e0d4' }}
                >
                  <img
                    src={tile.publicUrl}
                    alt={`Tile ${tile.index}`}
                    className="aspect-square w-full object-cover"
                  />
                  <a
                    href={tile.downloadUrl}
                    download={`line-${line.lineItemId}-tile-${tile.index}.png`}
                    className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity group-hover:opacity-100"
                  >
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                      <polyline points="7 10 12 15 17 10" />
                      <line x1="12" y1="15" x2="12" y2="3" />
                    </svg>
                  </a>
                </motion.div>
              ))}
            </div>
          </div>
        );
      })}

      {/* ZIP all lines × all tiles, line-prefixed filenames to avoid
          collision on `tile-0.png` across lines. */}
      <a
        href={`/api/admin/print-files?orderId=${encodeURIComponent(orderId)}&format=zip`}
        download
        className="flex h-10 w-full items-center justify-center gap-2 rounded-lg font-medium text-white transition-colors"
        style={{ backgroundColor: '#422102' }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
          <polyline points="7 10 12 15 17 10" />
          <line x1="12" y1="15" x2="12" y2="3" />
        </svg>
        Descargar todo (ZIP)
      </a>
    </div>
  );
}
