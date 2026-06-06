'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { OrderCard } from './OrderCard';
import type { AdminOrder, OrderStatus } from '@/lib/shopify/queries/orders';
import { getOrderStatus, isOrderActionable } from '@/lib/shopify/queries/orders';

type TabValue = OrderStatus | 'todos' | 'revisar';

const STATUS_TABS: { label: string; value: TabValue }[] = [
  { label: 'Todos', value: 'todos' },
  { label: 'Nuevos', value: 'nuevo' },
  { label: 'Imprimiendo', value: 'imprimiendo' },
  { label: 'Enviados', value: 'enviado' },
  { label: 'Entregados', value: 'entregado' },
  { label: 'Revisar', value: 'revisar' },
];

// Count helper shared by the tab badges and the filtered list. Non-actionable
// orders (cancelled / refunded / voided in Shopify) are kept OUT of the
// print-queue status tabs so that queue stays trustworthy; they live in the
// dedicated "Revisar" tab. "Todos" still shows everything (with badges).
function countForTab(orders: AdminOrder[], tab: TabValue): number {
  if (tab === 'todos') return orders.length;
  if (tab === 'revisar') return orders.filter((o) => !isOrderActionable(o)).length;
  return orders.filter((o) => isOrderActionable(o) && getOrderStatus(o) === tab).length;
}

export function OrdersListContent() {
  const [orders, setOrders] = useState<AdminOrder[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabValue>('todos');

  useEffect(() => {
    async function fetchOrders() {
      try {
        const res = await fetch('/api/admin/orders');
        if (!res.ok) {
          const data = await res.json();
          setError(data.error || 'Error al cargar pedidos.');
          return;
        }
        const data = await res.json();
        setOrders(data.orders);
      } catch {
        setError('Error de conexión.');
      } finally {
        setIsLoading(false);
      }
    }
    fetchOrders();
  }, []);

  const filteredOrders =
    activeTab === 'todos'
      ? orders
      : activeTab === 'revisar'
        ? orders.filter((order) => !isOrderActionable(order))
        : orders.filter(
            (order) => isOrderActionable(order) && getOrderStatus(order) === activeTab,
          );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-3 border-light-gray border-t-terracotta" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl bg-white p-8 text-center shadow-sm" style={{ border: '1px solid #e5e0d4' }}>
        <p className="text-warm-gray">{error}</p>
        <p className="mt-2 text-sm text-warm-gray/60">
          Asegúrate de que Shopify esté configurado correctamente.
        </p>
      </div>
    );
  }

  return (
    <div>
      {/* Filter tabs */}
      <div className="mb-6 flex gap-1 overflow-x-auto rounded-lg bg-white p-1 shadow-sm" style={{ border: '1px solid #e5e0d4' }}>
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.value}
            onClick={() => setActiveTab(tab.value)}
            className={[
              'cursor-pointer whitespace-nowrap rounded-md px-4 py-2 text-sm font-medium transition-colors',
              activeTab === tab.value
                ? 'bg-terracotta text-white'
                : 'text-warm-gray hover:bg-cream hover:text-charcoal',
            ].join(' ')}
          >
            {tab.label}
            {tab.value !== 'todos' && (
              <span className="ml-1.5 text-xs opacity-70">
                ({countForTab(orders, tab.value)})
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Orders list */}
      {filteredOrders.length === 0 ? (
        <div className="rounded-xl bg-white p-12 text-center shadow-sm" style={{ border: '1px solid #e5e0d4' }}>
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#7a6b5a" strokeWidth="1.5" className="mx-auto mb-4">
            <path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z" />
            <line x1="3" y1="6" x2="21" y2="6" />
            <path d="M16 10a4 4 0 01-8 0" />
          </svg>
          <p className="text-warm-gray">
            {activeTab === 'todos'
              ? 'No hay pedidos aún.'
              : activeTab === 'revisar'
                ? 'No hay pedidos cancelados o reembolsados para revisar.'
                : `No hay pedidos con estado "${STATUS_TABS.find((t) => t.value === activeTab)?.label}".`}
          </p>
        </div>
      ) : (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="flex flex-col gap-3"
        >
          {filteredOrders.map((order, index) => (
            <motion.div
              key={order.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.03 }}
            >
              <OrderCard order={order} />
            </motion.div>
          ))}
        </motion.div>
      )}
    </div>
  );
}
