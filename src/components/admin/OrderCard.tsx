'use client';

import Link from 'next/link';
import { StatusBadge } from './StatusBadge';
import type { AdminOrder, OrderStatus } from '@/lib/shopify/queries/orders';
import { getOrderStatus } from '@/lib/shopify/queries/orders';

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString('es-MX', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function formatMXN(amount: string): string {
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: 'MXN',
    minimumFractionDigits: 0,
  }).format(parseFloat(amount));
}

interface OrderCardProps {
  order: AdminOrder;
}

export function OrderCard({ order }: OrderCardProps) {
  const status: OrderStatus = getOrderStatus(order);

  // Extract preview image and grid type from line item attributes.
  // Keys carry the `_` prefix per the cart-attribute convention so the
  // webhook's `extractCustomizedLineItems` filter retains them. Phase 3.4
  // renamed `preview_image_url`/`grid_type` → `_preview_image_url`/`_grid_type`.
  const firstLineItem = order.lineItems.edges[0]?.node;
  const previewUrl = firstLineItem?.customAttributes.find(
    (a) => a.key === '_preview_image_url',
  )?.value;
  const gridType = firstLineItem?.customAttributes.find(
    (a) => a.key === '_grid_type',
  )?.value;

  const customerName = order.customer
    ? [order.customer.firstName, order.customer.lastName].filter(Boolean).join(' ')
    : null;

  return (
    <Link
      href={`/admin/pedidos/${order.id.replace('gid://shopify/Order/', '')}`}
      className="group block rounded-xl bg-white p-4 shadow-sm transition-shadow hover:shadow-md"
      style={{ border: '1px solid #e5e0d4' }}
    >
      <div className="flex items-start gap-4">
        {/* Preview thumbnail */}
        <div
          className="h-16 w-16 shrink-0 overflow-hidden rounded-lg bg-cream"
          style={{ border: '1px solid #e5e0d4' }}
        >
          {previewUrl ? (
            <img
              src={previewUrl}
              alt={`Pedido ${order.name}`}
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#7a6b5a" strokeWidth="1.5">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <polyline points="21 15 16 10 5 21" />
              </svg>
            </div>
          )}
        </div>

        {/* Order info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <span className="font-semibold text-charcoal">{order.name}</span>
            <StatusBadge status={status} />
          </div>
          <p className="mt-0.5 text-sm text-warm-gray truncate">
            {customerName || order.email}
          </p>
          <div className="mt-2 flex items-center gap-3 text-xs text-warm-gray">
            <span>{formatDate(order.createdAt)}</span>
            {gridType && (
              <span className="rounded bg-cream px-1.5 py-0.5 font-medium text-charcoal">
                {gridType}
              </span>
            )}
            <span className="ml-auto font-semibold text-charcoal">
              {formatMXN(order.totalPriceSet.shopMoney.amount)}
            </span>
          </div>
        </div>
      </div>
    </Link>
  );
}
