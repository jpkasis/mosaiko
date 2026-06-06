'use client';

import type { OrderSignal } from '@/lib/shopify/queries/orders';

// Mirrors StatusBadge's label/color-map shape. Each signal maps to a Spanish
// label + a Tailwind color pair. `severity` orders the badges so the most
// serious condition (cancelled/refunded) renders first when several apply.
const SIGNAL_CONFIG: Record<
  OrderSignal,
  { label: string; bgClass: string; textClass: string; severity: number }
> = {
  cancelled: { label: 'Cancelado', bgClass: 'bg-red-100', textClass: 'text-red-700', severity: 5 },
  refunded: { label: 'Reembolsado', bgClass: 'bg-red-100', textClass: 'text-red-700', severity: 4 },
  voided: { label: 'Anulado', bgClass: 'bg-gray-100', textClass: 'text-gray-600', severity: 3 },
  unpaid: { label: 'Pago pendiente', bgClass: 'bg-gray-100', textClass: 'text-gray-600', severity: 2 },
  partiallyRefunded: { label: 'Reembolso parcial', bgClass: 'bg-amber-100', textClass: 'text-amber-700', severity: 1 },
  refundPending: { label: 'Reembolso pendiente', bgClass: 'bg-amber-100', textClass: 'text-amber-700', severity: 0 },
};

interface OrderConditionBadgeProps {
  signals: OrderSignal[];
  /** When true, render only the single most-severe signal. */
  collapse?: boolean;
}

export function OrderConditionBadge({ signals, collapse = false }: OrderConditionBadgeProps) {
  if (signals.length === 0) return null;

  const sorted = [...signals].sort(
    (a, b) => SIGNAL_CONFIG[b].severity - SIGNAL_CONFIG[a].severity,
  );
  const shown = collapse ? sorted.slice(0, 1) : sorted;

  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {shown.map((signal) => {
        const config = SIGNAL_CONFIG[signal];
        return (
          <span
            key={signal}
            className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${config.bgClass} ${config.textClass}`}
          >
            {config.label}
          </span>
        );
      })}
    </span>
  );
}
