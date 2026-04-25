'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { StatusBadge } from './StatusBadge';
import { PrintFilesGrid } from './PrintFilesGrid';
import type { AdminOrder, OrderStatus } from '@/lib/shopify/queries/orders';
import { getOrderStatus } from '@/lib/shopify/queries/orders';

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString('es-MX', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatMXN(amount: string): string {
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: 'MXN',
    minimumFractionDigits: 0,
  }).format(parseFloat(amount));
}

const STATUS_FLOW: OrderStatus[] = ['nuevo', 'imprimiendo', 'enviado', 'entregado'];

interface OrderDetailContentProps {
  orderId: string;
}

export function OrderDetailContent({ orderId }: OrderDetailContentProps) {
  const [order, setOrder] = useState<AdminOrder | null>(null);
  const [currentStatus, setCurrentStatus] = useState<OrderStatus>('nuevo');
  const [isLoading, setIsLoading] = useState(true);
  const [isUpdating, setIsUpdating] = useState(false);
  const [showTrackingInput, setShowTrackingInput] = useState(false);
  const [trackingNumber, setTrackingNumber] = useState('');
  const [trackingCompany, setTrackingCompany] = useState('');

  useEffect(() => {
    async function fetchOrder() {
      try {
        // For now, fetch from the orders list and find by ID
        const res = await fetch('/api/admin/orders');
        if (res.ok) {
          const data = await res.json();
          const found = data.orders?.find((o: AdminOrder) =>
            o.id.includes(orderId) || String(o.orderNumber) === orderId,
          );
          if (found) {
            setOrder(found);
            setCurrentStatus(getOrderStatus(found));
          }
        }
      } catch {
        // Silently fail — empty state will show
      } finally {
        setIsLoading(false);
      }
    }
    fetchOrder();
  }, [orderId]);

  async function handleStatusUpdate(newStatus: OrderStatus) {
    if (!order || isUpdating) return;

    if (newStatus === 'enviado' && !showTrackingInput) {
      setShowTrackingInput(true);
      return;
    }

    setIsUpdating(true);

    try {
      const res = await fetch(`/api/admin/orders/${order.id.replace('gid://shopify/Order/', '')}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: newStatus,
          trackingNumber: newStatus === 'enviado' ? trackingNumber : undefined,
          trackingCompany: newStatus === 'enviado' ? trackingCompany : undefined,
          customerEmail: order.email,
          customerName: order.customer
            ? [order.customer.firstName, order.customer.lastName].filter(Boolean).join(' ')
            : undefined,
          orderNumber: order.name,
        }),
      });

      if (res.ok) {
        setCurrentStatus(newStatus);
        setShowTrackingInput(false);
      }
    } catch {
      // Error handling
    } finally {
      setIsUpdating(false);
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-3 border-light-gray border-t-terracotta" />
      </div>
    );
  }

  if (!order) {
    return (
      <div className="rounded-xl bg-white p-8 text-center shadow-sm" style={{ border: '1px solid #e5e0d4' }}>
        <p className="text-warm-gray">Pedido no encontrado.</p>
        <Link href="/admin/pedidos" className="mt-4 inline-block text-sm text-terracotta hover:underline">
          Volver a pedidos
        </Link>
      </div>
    );
  }

  const customerName = order.customer
    ? [order.customer.firstName, order.customer.lastName].filter(Boolean).join(' ')
    : null;

  // Extract custom attributes from first line item
  const lineItems = order.lineItems.edges.map((e) => e.node);
  const printJobId = lineItems[0]?.customAttributes.find((a) => a.key === '_photo_url')
    ? `order-${order.id.replace('gid://shopify/Order/', '')}-item-${lineItems[0].id.replace('gid://shopify/LineItem/', '')}`
    : null;

  const currentStatusIndex = STATUS_FLOW.indexOf(currentStatus);

  return (
    <div>
      {/* Back link */}
      <Link
        href="/admin/pedidos"
        className="mb-6 inline-flex items-center gap-1.5 text-sm text-warm-gray hover:text-charcoal"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="19" y1="12" x2="5" y2="12" />
          <polyline points="12 19 5 12 12 5" />
        </svg>
        Volver a pedidos
      </Link>

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        {/* Left column */}
        <div className="flex flex-col gap-6">
          {/* Order info card */}
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-xl bg-white p-6 shadow-sm"
            style={{ border: '1px solid #e5e0d4' }}
          >
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-semibold text-charcoal" style={{ fontFamily: 'var(--font-cormorant), Georgia, serif' }}>
                  {order.name}
                </h2>
                <p className="mt-1 text-sm text-warm-gray">{formatDate(order.createdAt)}</p>
              </div>
              <StatusBadge status={currentStatus} />
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div>
                <span className="text-xs font-medium uppercase tracking-wider text-warm-gray">Cliente</span>
                <p className="mt-0.5 text-sm text-charcoal">{customerName || '—'}</p>
                <p className="text-sm text-warm-gray">{order.email}</p>
              </div>
              <div>
                <span className="text-xs font-medium uppercase tracking-wider text-warm-gray">Pago</span>
                <p className="mt-0.5 text-sm text-charcoal">{order.displayFinancialStatus}</p>
                <p className="text-lg font-bold text-charcoal">
                  {formatMXN(order.totalPriceSet.shopMoney.amount)}
                </p>
              </div>
            </div>

            {order.shippingAddress && (
              <div className="mt-4">
                <span className="text-xs font-medium uppercase tracking-wider text-warm-gray">Dirección de envío</span>
                <p className="mt-0.5 text-sm text-charcoal">
                  {[
                    order.shippingAddress.address1,
                    order.shippingAddress.address2,
                    order.shippingAddress.city,
                    order.shippingAddress.province,
                    order.shippingAddress.zip,
                    order.shippingAddress.country,
                  ]
                    .filter(Boolean)
                    .join(', ')}
                </p>
              </div>
            )}
          </motion.div>

          {/* Line items */}
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="rounded-xl bg-white p-6 shadow-sm"
            style={{ border: '1px solid #e5e0d4' }}
          >
            <h3 className="mb-4 font-semibold text-charcoal" style={{ fontFamily: 'var(--font-cormorant), Georgia, serif' }}>
              Productos
            </h3>
            <div className="flex flex-col gap-4">
              {lineItems.map((item) => {
                // `_`-prefixed keys per Phase 3.4 attr-naming reconciliation
                // (matches the cart-attribute convention so the webhook's
                // extractCustomizedLineItems filter keeps them).
                const previewUrl = item.customAttributes.find((a) => a.key === '_preview_image_url')?.value;
                const gridType = item.customAttributes.find((a) => a.key === '_grid_type')?.value;
                const category = item.customAttributes.find((a) => a.key === 'category')?.value;

                return (
                  <div key={item.id} className="flex gap-4 rounded-lg bg-cream p-3">
                    <div className="h-20 w-20 shrink-0 overflow-hidden rounded-lg" style={{ border: '1px solid #e5e0d4' }}>
                      {previewUrl ? (
                        <img src={previewUrl} alt={item.title} className="h-full w-full object-cover" />
                      ) : item.image ? (
                        <img src={item.image.url} alt={item.title} className="h-full w-full object-cover" />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center bg-white">
                          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#7a6b5a" strokeWidth="1.5">
                            <rect x="3" y="3" width="18" height="18" rx="2" />
                          </svg>
                        </div>
                      )}
                    </div>
                    <div className="flex-1">
                      <p className="font-medium text-charcoal">{item.title}</p>
                      <div className="mt-1 flex flex-wrap gap-2 text-xs text-warm-gray">
                        {gridType && <span className="rounded bg-white px-1.5 py-0.5">{gridType}</span>}
                        {category && <span className="rounded bg-white px-1.5 py-0.5">{category}</span>}
                        <span>x{item.quantity}</span>
                      </div>
                      {item.variant && (
                        <p className="mt-1 text-sm font-semibold text-charcoal">
                          {formatMXN(item.variant.price)}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </motion.div>
        </div>

        {/* Right column */}
        <div className="flex flex-col gap-6">
          {/* Status controls */}
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
            className="rounded-xl bg-white p-6 shadow-sm"
            style={{ border: '1px solid #e5e0d4' }}
          >
            <h3 className="mb-4 font-semibold text-charcoal" style={{ fontFamily: 'var(--font-cormorant), Georgia, serif' }}>
              Estado del pedido
            </h3>

            {/* Status pipeline */}
            <div className="mb-4 flex items-center justify-between">
              {STATUS_FLOW.map((status, index) => {
                const isActive = index <= currentStatusIndex;
                return (
                  <div key={status} className="flex items-center">
                    <div
                      className={[
                        'flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold',
                        isActive ? 'bg-terracotta text-white' : 'bg-light-gray text-warm-gray',
                      ].join(' ')}
                    >
                      {index < currentStatusIndex ? (
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      ) : (
                        index + 1
                      )}
                    </div>
                    {index < STATUS_FLOW.length - 1 && (
                      <div className={`mx-1 h-0.5 w-4 ${index < currentStatusIndex ? 'bg-terracotta' : 'bg-light-gray'}`} />
                    )}
                  </div>
                );
              })}
            </div>

            {/* Next status button */}
            {currentStatusIndex < STATUS_FLOW.length - 1 && (
              <div>
                {showTrackingInput && (
                  <div className="mb-3 flex flex-col gap-2">
                    <input
                      type="text"
                      placeholder="Número de guía"
                      value={trackingNumber}
                      onChange={(e) => setTrackingNumber(e.target.value)}
                      className="h-9 rounded-lg border border-light-gray bg-cream px-3 text-sm focus:border-terracotta focus:outline-none"
                    />
                    <input
                      type="text"
                      placeholder="Paquetería (ej. Estafeta, DHL)"
                      value={trackingCompany}
                      onChange={(e) => setTrackingCompany(e.target.value)}
                      className="h-9 rounded-lg border border-light-gray bg-cream px-3 text-sm focus:border-terracotta focus:outline-none"
                    />
                  </div>
                )}

                <button
                  onClick={() => handleStatusUpdate(STATUS_FLOW[currentStatusIndex + 1])}
                  disabled={isUpdating || (showTrackingInput && !trackingNumber)}
                  className="flex h-10 w-full cursor-pointer items-center justify-center gap-2 rounded-lg font-medium text-white transition-colors disabled:opacity-60"
                  style={{ backgroundColor: '#7b3f1e' }}
                >
                  {isUpdating ? (
                    <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="31.4 31.4" strokeLinecap="round" />
                    </svg>
                  ) : (
                    <>
                      Marcar como &quot;{STATUS_FLOW[currentStatusIndex + 1].charAt(0).toUpperCase() + STATUS_FLOW[currentStatusIndex + 1].slice(1)}&quot;
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                        <line x1="5" y1="12" x2="19" y2="12" />
                        <polyline points="12 5 19 12 12 19" />
                      </svg>
                    </>
                  )}
                </button>
              </div>
            )}
          </motion.div>

          {/* Print files */}
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="rounded-xl bg-white p-6 shadow-sm"
            style={{ border: '1px solid #e5e0d4' }}
          >
            <h3 className="mb-4 font-semibold text-charcoal" style={{ fontFamily: 'var(--font-cormorant), Georgia, serif' }}>
              Archivos de impresión
            </h3>
            {printJobId ? (
              <PrintFilesGrid orderId={printJobId} />
            ) : (
              <div className="rounded-lg bg-cream p-4 text-center text-sm text-warm-gray">
                Archivos pendientes de generación.
              </div>
            )}
          </motion.div>
        </div>
      </div>
    </div>
  );
}
