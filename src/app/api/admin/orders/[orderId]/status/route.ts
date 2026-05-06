import { NextRequest, NextResponse } from 'next/server';
import { verifySession } from '@/lib/admin/auth';
import { updateOrderMetafield, createFulfillment } from '@/lib/shopify/mutations/orders';

// ─── PATCH /api/admin/orders/[orderId]/status ───────────────────────────────
//
// Updates order fulfillment status metafield. When status flips to
// "enviado", also creates a Shopify fulfillment with `notifyCustomer:
// true` — Shopify sends its native shipping-notification email
// directly. (No Resend dependency post-Shopify-Files migration.)

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ orderId: string }> },
) {
  // Verify admin session
  const isAdmin = await verifySession();
  if (!isAdmin) {
    return NextResponse.json({ error: 'No autorizado.' }, { status: 401 });
  }

  const { orderId } = await params;

  // Validate orderId format (prevent path traversal / injection)
  if (!/^[\w-]+$/.test(orderId)) {
    return NextResponse.json(
      { error: 'Formato de orderId inválido.' },
      { status: 400 },
    );
  }

  try {
    const body = await request.json();
    const { status, trackingNumber, trackingCompany } = body;

    const validStatuses = ['nuevo', 'imprimiendo', 'enviado', 'entregado'];
    if (!validStatuses.includes(status)) {
      return NextResponse.json(
        { error: `Estado inválido. Opciones: ${validStatuses.join(', ')}` },
        { status: 400 },
      );
    }

    // Update metafield
    await updateOrderMetafield(orderId, 'mosaiko', 'fulfillment_status', status);

    // If shipping, create fulfillment. `notifyCustomer: true` (set in
    // `createFulfillment`) tells Shopify to send the native shipping
    // email directly — no Resend round-trip.
    //
    // Codex audit (high): we now SURFACE fulfillment errors to the
    // caller. Pre-fix the catch swallowed the error and returned 200,
    // which (with Resend removed) would silently mark the order
    // shipped without ever actually fulfilling it or emailing the
    // customer.
    if (status === 'enviado' && trackingNumber) {
      try {
        await createFulfillment(orderId, trackingNumber, trackingCompany);
      } catch (error) {
        console.error(
          '[api/admin/orders/status] Fulfillment creation failed:',
          error,
        );
        return NextResponse.json(
          {
            error: 'fulfillment_failed',
            detail: error instanceof Error ? error.message : String(error),
            statusMetafield: status,
          },
          { status: 502 },
        );
      }
    }

    return NextResponse.json({ success: true, status });
  } catch (error) {
    console.error('[api/admin/orders/status] Error:', error);
    return NextResponse.json(
      { error: 'Error al actualizar el estado.' },
      { status: 500 },
    );
  }
}
