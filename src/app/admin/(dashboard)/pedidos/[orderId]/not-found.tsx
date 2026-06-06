import Link from 'next/link';

// Rendered when `getOrderById` returns null (order deleted in Shopify, or a
// non-numeric id). Lives inside the admin dashboard layout so it stays in the
// admin shell instead of falling back to the global full-page 404.
export default function OrderNotFound() {
  return (
    <div className="rounded-xl bg-white p-8 text-center shadow-sm" style={{ border: '1px solid #e5e0d4' }}>
      <p className="text-warm-gray">Pedido no encontrado.</p>
      <p className="mt-1 text-sm text-warm-gray/60">
        Es posible que el pedido haya sido eliminado en Shopify.
      </p>
      <Link href="/admin/pedidos" className="mt-4 inline-block text-sm text-terracotta hover:underline">
        Volver a pedidos
      </Link>
    </div>
  );
}
