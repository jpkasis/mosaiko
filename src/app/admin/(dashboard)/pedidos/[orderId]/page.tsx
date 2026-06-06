import { notFound } from 'next/navigation';
import { OrderDetailContent } from '@/components/admin/OrderDetailContent';
import { getOrderById } from '@/lib/shopify/queries/orders';

export default async function OrderDetailPage({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  const { orderId } = await params;

  // The route param is the numeric Shopify order id (the `gid://` prefix is
  // stripped in the links). Reconstruct the GID for the Admin API lookup.
  // Anything non-numeric can't be a valid Shopify order id → 404.
  if (!/^\d+$/.test(orderId)) {
    notFound();
  }

  // Read LIVE from Shopify (cache: 'no-store') so the detail reflects the
  // current cancellation/refund + pipeline state. Deleted-in-Shopify → 404.
  const order = await getOrderById(`gid://shopify/Order/${orderId}`);
  if (!order) {
    notFound();
  }

  return <OrderDetailContent order={order} />;
}
