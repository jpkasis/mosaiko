import { Resend } from 'resend';

// ─── Resend client ──────────────────────────────────────────────────────────

let _resend: Resend | null = null;

function getResend(): Resend {
  if (!_resend) {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      throw new Error('[email] RESEND_API_KEY not configured');
    }
    _resend = new Resend(apiKey);
  }
  return _resend;
}

const FROM_ADDRESS = process.env.RESEND_FROM_EMAIL || 'Mosaiko <pedidos@mosaiko.mx>';
const ADMIN_EMAIL = process.env.ADMIN_NOTIFICATION_EMAIL || '';

// ─── Order data types ───────────────────────────────────────────────────────

export interface OrderEmailData {
  orderNumber: string | number;
  customerEmail: string;
  customerName?: string;
  items: {
    title: string;
    gridType: string;
    quantity: number;
    previewImageUrl?: string;
  }[];
  totalAmount?: string;
  printFileDownloadUrl?: string;
  /**
   * Overall status of the print pipeline for this order. When omitted or
   * 'complete', the admin email renders as before. When 'partial' or
   * 'failed' the admin gets an explicit banner + failure list so the
   * order can be investigated/retried instead of silently shipping with
   * missing tiles.
   */
  pipelineStatus?: 'complete' | 'partial' | 'failed' | 'empty';
  /**
   * Per-line-item failures — present only when pipelineStatus is
   * 'partial' or 'failed'. Admin uses these to know which lines to
   * retry via `/api/admin/orders/[orderId]/retry-line`.
   */
  failedItems?: Array<{
    lineItemId: number;
    title: string;
    quantity: number;
    reason: string;
    detail?: string;
  }>;
}

// ─── Send order confirmation to customer ─────────────────────────────────────

export async function sendOrderConfirmation(data: OrderEmailData): Promise<void> {
  if (!process.env.RESEND_API_KEY) {
    console.warn('[email] Resend not configured, skipping customer email');
    return;
  }

  const resend = getResend();

  const itemsHtml = data.items
    .map(
      (item) => `
      <tr>
        <td style="padding: 12px 0; border-bottom: 1px solid #e5e0d4;">
          <div style="display: flex; align-items: center; gap: 12px;">
            ${item.previewImageUrl ? `<img src="${item.previewImageUrl}" alt="${item.title}" style="width: 60px; height: 60px; border-radius: 8px; object-fit: cover;" />` : ''}
            <div>
              <strong style="color: #422102;">${item.title}</strong>
              <br />
              <span style="color: #7a6b5a; font-size: 13px;">${item.gridType} — Cantidad: ${item.quantity}</span>
            </div>
          </div>
        </td>
      </tr>
    `,
    )
    .join('');

  await resend.emails.send({
    from: FROM_ADDRESS,
    to: data.customerEmail,
    subject: `Pedido #${data.orderNumber} confirmado — Mosaiko`,
    html: `
      <!DOCTYPE html>
      <html lang="es">
      <head><meta charset="utf-8" /></head>
      <body style="margin: 0; padding: 0; font-family: 'DM Sans', -apple-system, sans-serif; background-color: #efebe0;">
        <div style="max-width: 560px; margin: 0 auto; padding: 40px 20px;">
          <!-- Header -->
          <div style="text-align: center; margin-bottom: 32px;">
            <h1 style="font-family: 'Cormorant Garamond', Garamond, Georgia, serif; color: #422102; font-size: 28px; margin: 0;">Mosaiko</h1>
          </div>

          <!-- Card -->
          <div style="background: white; border-radius: 16px; padding: 32px; box-shadow: 0 1px 4px rgba(0,0,0,0.06);">
            <h2 style="font-family: 'Cormorant Garamond', Garamond, Georgia, serif; color: #422102; font-size: 22px; margin: 0 0 8px;">
              ¡Pedido confirmado!
            </h2>
            <p style="color: #7a6b5a; margin: 0 0 24px; font-size: 15px;">
              Pedido #${data.orderNumber}
            </p>

            <p style="color: #422102; font-size: 15px; line-height: 1.6;">
              ${data.customerName ? `Hola ${data.customerName}, g` : 'G'}racias por tu compra.
              Estamos preparando tus imanes personalizados con mucho cariño.
            </p>

            <!-- Items -->
            <table style="width: 100%; border-collapse: collapse; margin: 24px 0;">
              ${itemsHtml}
            </table>

            ${data.totalAmount ? `<p style="text-align: right; font-size: 18px; font-weight: 700; color: #422102; margin: 16px 0 0;">Total: ${data.totalAmount}</p>` : ''}

            <!-- Timeline -->
            <div style="background: #e5e0d4; border-radius: 12px; padding: 20px; margin-top: 24px;">
              <p style="margin: 0; font-weight: 600; color: #422102; font-size: 14px;">Tiempo estimado de entrega</p>
              <p style="margin: 4px 0 0; color: #7a6b5a; font-size: 13px;">5 a 10 días hábiles — Envío gratis a toda la República Mexicana</p>
            </div>
          </div>

          <!-- Footer -->
          <div style="text-align: center; margin-top: 32px; color: #7a6b5a; font-size: 12px;">
            <p>Mosaiko — Imanes personalizados con tu foto</p>
          </div>
        </div>
      </body>
      </html>
    `,
  });
}

// ─── Send admin notification ─────────────────────────────────────────────────

export async function sendAdminNotification(data: OrderEmailData): Promise<void> {
  if (!process.env.RESEND_API_KEY || !ADMIN_EMAIL) {
    console.warn('[email] Resend or admin email not configured, skipping admin notification');
    return;
  }

  const resend = getResend();

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://mosaiko.mx';
  const adminOrderUrl = `${siteUrl}/admin/pedidos/${data.orderNumber}`;

  const itemsList = data.items
    .map((item) => `<li>${item.title} (${item.gridType}) x${item.quantity}</li>`)
    .join('');

  // Pipeline-status banner: only when the print pipeline didn't cleanly
  // produce all tiles. Drives the admin to investigate + retry instead
  // of assuming "email arrived, everything is fine".
  const showFailureBanner =
    data.pipelineStatus === 'partial' || data.pipelineStatus === 'failed';
  const failedCount = data.failedItems?.length ?? 0;
  const totalCount = data.items.length;
  const bannerText =
    data.pipelineStatus === 'failed'
      ? `⚠ Todos los artículos (${totalCount}) fallaron en el pipeline de impresión.`
      : `⚠ ${failedCount} de ${totalCount} artículos fallaron — revisar y reintentar.`;

  const failureListHtml = data.failedItems?.length
    ? `
      <h3 style="margin: 20px 0 8px; color: #b71c1c;">Artículos con fallas:</h3>
      <ul style="margin: 0; padding-left: 20px; color: #555;">
        ${data.failedItems
          .map(
            (f) =>
              `<li><strong>${f.title}</strong> x${f.quantity} — <em>${f.reason}</em>${f.detail ? ` (${f.detail})` : ''}</li>`,
          )
          .join('')}
      </ul>
    `
    : '';

  const subjectPrefix = showFailureBanner
    ? data.pipelineStatus === 'failed'
      ? '🚨 FALLO'
      : '⚠ PARCIAL'
    : '🧲';

  await resend.emails.send({
    from: FROM_ADDRESS,
    to: ADMIN_EMAIL,
    subject: `${subjectPrefix} Nuevo pedido #${data.orderNumber}`,
    html: `
      <!DOCTYPE html>
      <html lang="es">
      <head><meta charset="utf-8" /></head>
      <body style="margin: 0; padding: 0; font-family: -apple-system, sans-serif; background-color: #f5f5f5;">
        <div style="max-width: 520px; margin: 0 auto; padding: 32px 16px;">
          <div style="background: white; border-radius: 12px; padding: 28px; box-shadow: 0 1px 4px rgba(0,0,0,0.08);">
            <h2 style="color: #7b3f1e; margin: 0 0 16px;">Nuevo pedido #${data.orderNumber}</h2>

            ${showFailureBanner ? `
              <div style="background: #fdecea; border-left: 4px solid #b71c1c; padding: 12px 16px; border-radius: 6px; margin-bottom: 16px;">
                <p style="margin: 0; color: #b71c1c; font-weight: 700; font-size: 14px;">${bannerText}</p>
              </div>
            ` : ''}

            <p style="margin: 0 0 4px;"><strong>Cliente:</strong> ${data.customerEmail}</p>
            ${data.customerName ? `<p style="margin: 0 0 4px;"><strong>Nombre:</strong> ${data.customerName}</p>` : ''}

            <h3 style="margin: 20px 0 8px; color: #333;">Productos:</h3>
            <ul style="margin: 0; padding-left: 20px; color: #555;">${itemsList}</ul>

            ${failureListHtml}

            ${data.totalAmount ? `<p style="margin: 16px 0 0; font-size: 16px;"><strong>Total: ${data.totalAmount}</strong></p>` : ''}

            <div style="margin-top: 24px;">
              <a href="${adminOrderUrl}"
                 style="display: inline-block; background: #422102; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600;">
                Ver pedido en admin
              </a>
            </div>

            ${data.printFileDownloadUrl && !showFailureBanner ? `
              <div style="margin-top: 16px;">
                <a href="${data.printFileDownloadUrl}"
                   style="color: #422102; text-decoration: underline; font-size: 14px;">
                  Descargar archivos de impresión
                </a>
              </div>
            ` : ''}
          </div>
        </div>
      </body>
      </html>
    `,
  });
}

// ─── Send shipping notification ──────────────────────────────────────────────

export async function sendShippingNotification(data: {
  customerEmail: string;
  customerName?: string;
  orderNumber: string | number;
  trackingNumber: string;
  trackingCompany?: string;
}): Promise<void> {
  if (!process.env.RESEND_API_KEY) {
    console.warn('[email] Resend not configured, skipping shipping email');
    return;
  }

  const resend = getResend();

  await resend.emails.send({
    from: FROM_ADDRESS,
    to: data.customerEmail,
    subject: `Tu pedido #${data.orderNumber} ha sido enviado — Mosaiko`,
    html: `
      <!DOCTYPE html>
      <html lang="es">
      <head><meta charset="utf-8" /></head>
      <body style="margin: 0; padding: 0; font-family: 'DM Sans', -apple-system, sans-serif; background-color: #efebe0;">
        <div style="max-width: 560px; margin: 0 auto; padding: 40px 20px;">
          <div style="text-align: center; margin-bottom: 32px;">
            <h1 style="font-family: 'Cormorant Garamond', Garamond, Georgia, serif; color: #422102; font-size: 28px; margin: 0;">Mosaiko</h1>
          </div>

          <div style="background: white; border-radius: 16px; padding: 32px; box-shadow: 0 1px 4px rgba(0,0,0,0.06);">
            <h2 style="font-family: 'Cormorant Garamond', Garamond, Georgia, serif; color: #422102; font-size: 22px; margin: 0 0 16px;">
              ¡Tu pedido va en camino!
            </h2>

            <p style="color: #422102; font-size: 15px; line-height: 1.6;">
              ${data.customerName ? `Hola ${data.customerName}, t` : 'T'}u pedido #${data.orderNumber} ha sido enviado.
            </p>

            <div style="background: #e5e0d4; border-radius: 12px; padding: 20px; margin: 20px 0;">
              <p style="margin: 0 0 4px; font-weight: 600; color: #422102; font-size: 14px;">Número de guía</p>
              <p style="margin: 0; color: #7b3f1e; font-size: 16px; font-weight: 700;">${data.trackingNumber}</p>
              ${data.trackingCompany ? `<p style="margin: 4px 0 0; color: #7a6b5a; font-size: 13px;">${data.trackingCompany}</p>` : ''}
            </div>

            <p style="color: #7a6b5a; font-size: 13px; line-height: 1.6;">
              Recibirás tus imanes en los próximos días. Si tienes alguna pregunta, no dudes en contactarnos.
            </p>
          </div>

          <div style="text-align: center; margin-top: 32px; color: #7a6b5a; font-size: 12px;">
            <p>Mosaiko — Imanes personalizados con tu foto</p>
          </div>
        </div>
      </body>
      </html>
    `,
  });
}
