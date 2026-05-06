import { NextResponse } from 'next/server';
import { verifySession } from '@/lib/admin/auth';
import { isAdminConfigured } from '@/lib/shopify/client';

// ─── GET /api/admin/orders ──────────────────────────────────────────────────
//
// Returns orders from Shopify Admin API.
// Falls back to empty array if Shopify is not configured.

export async function GET() {
  const isAdmin = await verifySession();
  if (!isAdmin) {
    return NextResponse.json({ error: 'No autorizado.' }, { status: 401 });
  }

  // Check if Shopify is configured
  const storeDomain =
    process.env.SHOPIFY_STORE_DOMAIN ??
    process.env.NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN;
  if (!storeDomain || !isAdminConfigured()) {
    return NextResponse.json({
      orders: [],
      message: 'Shopify no está configurado. Los pedidos aparecerán aquí cuando la tienda esté conectada.',
    });
  }

  try {
    const { getOrders } = await import('@/lib/shopify/queries/orders');
    const orders = await getOrders(50);
    return NextResponse.json({ orders });
  } catch (error) {
    console.error('[api/admin/orders] Error fetching orders:', error);
    return NextResponse.json(
      { error: 'Error al obtener los pedidos.', orders: [] },
      { status: 500 },
    );
  }
}
