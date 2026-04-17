import { NextRequest, NextResponse, after } from 'next/server';
import crypto from 'node:crypto';
import { uploadPrintTiles } from '@/lib/storage';
import type { CategoryCustomization } from '@/lib/customization-types';
import { sendOrderConfirmation, sendAdminNotification } from '@/lib/email/resend-client';

// ─── Environment ─────────────────────────────────────────────────────────────

const SHOPIFY_WEBHOOK_SECRET = process.env.SHOPIFY_WEBHOOK_SECRET!;
const SHOPIFY_ADMIN_API_TOKEN = process.env.SHOPIFY_ADMIN_API_TOKEN!;
const SHOPIFY_STORE_DOMAIN =
  process.env.SHOPIFY_STORE_DOMAIN ??
  process.env.NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN ??
  '';

// ─── Types ───────────────────────────────────────────────────────────────────

interface ShopifyLineItemProperty {
  name: string;
  value: string;
}

interface ShopifyLineItem {
  id: number;
  title: string;
  quantity: number;
  variant_id: number;
  properties: ShopifyLineItemProperty[];
}

interface ShopifyOrderWebhook {
  id: number;
  order_number: number;
  name: string;
  email: string;
  line_items: ShopifyLineItem[];
}

// ─── HMAC verification ──────────────────────────────────────────────────────

/**
 * Verifies the Shopify webhook HMAC-SHA256 signature.
 * Compares the computed HMAC against the X-Shopify-Hmac-Sha256 header
 * using timing-safe comparison to prevent timing attacks.
 */
function verifyShopifyHmac(rawBody: string, hmacHeader: string): boolean {
  const computed = crypto
    .createHmac('sha256', SHOPIFY_WEBHOOK_SECRET)
    .update(rawBody, 'utf8')
    .digest('base64');

  // Both must be the same length for timingSafeEqual
  const computedBuffer = Buffer.from(computed, 'utf8');
  const receivedBuffer = Buffer.from(hmacHeader, 'utf8');

  if (computedBuffer.length !== receivedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(computedBuffer, receivedBuffer);
}

// ─── Extract custom attributes from line items ─────────────────────────────

/**
 * Extracts line items that have custom photo attributes.
 * Convention: custom attributes have keys prefixed with "_".
 */
function extractCustomizedLineItems(order: ShopifyOrderWebhook) {
  return order.line_items
    .filter((item) =>
      item.properties.some((prop) => prop.name.startsWith('_')),
    )
    .map((item) => {
      const attrs: Record<string, string> = {};
      for (const prop of item.properties) {
        if (prop.name.startsWith('_')) {
          attrs[prop.name] = prop.value;
        }
      }
      return {
        lineItemId: item.id,
        title: item.title,
        quantity: item.quantity,
        attrs,
      };
    });
}

// ─── Update order metafields via Shopify Admin API ──────────────────────────

/**
 * Updates an order's metafields with print file URLs after generation.
 */
async function updateOrderMetafields(
  orderId: number,
  printFileUrls: string[],
): Promise<void> {
  if (!SHOPIFY_STORE_DOMAIN || !SHOPIFY_ADMIN_API_TOKEN) {
    console.warn(
      '[webhook/shopify] Shopify Admin API not configured, skipping metafield update',
    );
    return;
  }

  const url = `https://${SHOPIFY_STORE_DOMAIN}/admin/api/2024-01/orders/${orderId}/metafields.json`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': SHOPIFY_ADMIN_API_TOKEN,
    },
    body: JSON.stringify({
      metafield: {
        namespace: 'mosaiko',
        key: 'print_files',
        value: JSON.stringify(printFileUrls),
        type: 'json',
      },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(
      `[webhook/shopify] Failed to update metafields for order ${orderId}:`,
      errorText,
    );
  }
}

// ─── Process a single customized line item ──────────────────────────────────

// ─── SSRF prevention: only fetch from trusted origins ───────────────────────

const R2_PUBLIC_DOMAIN = process.env.R2_PUBLIC_URL
  ? new URL(process.env.R2_PUBLIC_URL).hostname
  : 'r2.mosaiko.mx';

const ALLOWED_PHOTO_HOSTS = new Set([R2_PUBLIC_DOMAIN, 'cdn.shopify.com']);
const FETCH_TIMEOUT_MS = 15_000;
const MAX_IMAGE_SIZE = 20 * 1024 * 1024;

function isAllowedPhotoUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && ALLOWED_PHOTO_HOSTS.has(parsed.hostname);
  } catch {
    return false;
  }
}

async function fetchPhotoBuffer(url: string): Promise<Buffer | null> {
  if (!isAllowedPhotoUrl(url)) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_IMAGE_SIZE) return null;
    return buf;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function processLineItem(
  orderId: number,
  lineItem: {
    lineItemId: number;
    title: string;
    quantity: number;
    attrs: Record<string, string>;
  },
): Promise<string[]> {
  const customizationRaw = lineItem.attrs['_customization'];

  if (!customizationRaw) {
    console.warn(
      `[webhook/shopify] Line item ${lineItem.lineItemId} missing _customization, skipping`,
    );
    return [];
  }

  let customization: CategoryCustomization;
  try {
    customization = JSON.parse(customizationRaw);
  } catch (error) {
    console.error(
      `[webhook/shopify] Line item ${lineItem.lineItemId}: failed to parse _customization:`,
      error,
    );
    return [];
  }

  const { processPrintJob } = await import('@/lib/print-pipeline');
  const jobId = `order-${orderId}-item-${lineItem.lineItemId}`;

  if (customization.categoryType === 'tonos') {
    const urlsRaw = lineItem.attrs['_photo_urls'];
    const cropsRaw = lineItem.attrs['_crop_areas'];
    if (!urlsRaw || !cropsRaw) {
      console.warn(
        `[webhook/shopify] Tonos line item ${lineItem.lineItemId} missing _photo_urls / _crop_areas`,
      );
      return [];
    }

    let urls: string[];
    let crops: Array<{ x: number; y: number; width: number; height: number }>;
    try {
      urls = JSON.parse(urlsRaw);
      crops = JSON.parse(cropsRaw);
    } catch (error) {
      console.error(
        `[webhook/shopify] Tonos line item ${lineItem.lineItemId}: invalid JSON`,
        error,
      );
      return [];
    }

    if (urls.length !== 3 || crops.length !== 3) {
      console.error(
        `[webhook/shopify] Tonos line item ${lineItem.lineItemId}: expected 3 urls and 3 crops`,
      );
      return [];
    }

    const buffers = await Promise.all(urls.map(fetchPhotoBuffer));
    if (buffers.some((b) => !b)) {
      console.error(
        `[webhook/shopify] Tonos line item ${lineItem.lineItemId}: photo fetch failed`,
      );
      return [];
    }

    // Pull per-slot rotations out of the customization JSON if present.
    const slotsRaw = (customization as unknown as {
      tonosSlots?: Array<{ rotation?: number }>;
    }).tonosSlots;
    let rotations: [number, number, number] | undefined;
    if (Array.isArray(slotsRaw) && slotsRaw.length === 3) {
      const rs = slotsRaw.map((s) => {
        const r = typeof s?.rotation === 'number' ? s.rotation : 0;
        return [0, 90, 180, 270].includes(r) ? r : 0;
      });
      rotations = [rs[0], rs[1], rs[2]];
    }

    const result = await processPrintJob({
      imageBuffers: [buffers[0]!, buffers[1]!, buffers[2]!],
      customization,
      cropAreas: [crops[0], crops[1], crops[2]],
      rotations,
      jobId,
    });

    const storedTiles = await uploadPrintTiles(
      jobId,
      result.tiles.map((tile) => ({ index: tile.index, buffer: tile.buffer })),
    );
    return storedTiles.map((t) => t.publicUrl);
  }

  // Single-image categories
  const photoUrl = lineItem.attrs['_photo_url'];
  const cropAreaRaw = lineItem.attrs['_crop_area'];

  if (!photoUrl || !cropAreaRaw) {
    console.warn(
      `[webhook/shopify] Line item ${lineItem.lineItemId} missing _photo_url / _crop_area, skipping`,
    );
    return [];
  }

  let cropArea: { x: number; y: number; width: number; height: number };
  try {
    cropArea = JSON.parse(cropAreaRaw);
  } catch (error) {
    console.error(
      `[webhook/shopify] Line item ${lineItem.lineItemId}: failed to parse _crop_area:`,
      error,
    );
    return [];
  }

  const imageBuffer = await fetchPhotoBuffer(photoUrl);
  if (!imageBuffer) {
    console.error(
      `[webhook/shopify] Line item ${lineItem.lineItemId}: photo fetch failed`,
    );
    return [];
  }

  const result = await processPrintJob({
    imageBuffer,
    customization,
    cropArea,
    jobId,
  });

  // Upload tiles to R2
  const storedTiles = await uploadPrintTiles(
    jobId,
    result.tiles.map((tile) => ({
      index: tile.index,
      buffer: tile.buffer,
    })),
  );

  return storedTiles.map((t) => t.publicUrl);
}

// ─── POST /api/webhooks/shopify ─────────────────────────────────────────────

export async function POST(request: NextRequest) {
  // ── Read raw body for HMAC verification ─────────────────────────────

  const rawBody = await request.text();
  const hmacHeader = request.headers.get('X-Shopify-Hmac-Sha256');

  if (!hmacHeader) {
    return NextResponse.json(
      { error: 'Missing HMAC signature header' },
      { status: 401 },
    );
  }

  // ── Verify HMAC ───────────────────────────────────────────────────────

  if (!verifyShopifyHmac(rawBody, hmacHeader)) {
    console.error('[webhook/shopify] HMAC verification failed');
    return NextResponse.json(
      { error: 'Invalid HMAC signature' },
      { status: 401 },
    );
  }

  // ── Parse order payload ───────────────────────────────────────────────

  let order: ShopifyOrderWebhook;
  try {
    order = JSON.parse(rawBody) as ShopifyOrderWebhook;
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON payload' },
      { status: 400 },
    );
  }

  // ── Extract customized line items ─────────────────────────────────────

  const customizedItems = extractCustomizedLineItems(order);

  if (customizedItems.length === 0) {
    // No custom photo items in this order -- nothing to process
    return NextResponse.json({ status: 'ok', message: 'No custom items' });
  }

  // ── Process line items ────────────────────────────────────────────────
  //
  // Respond immediately (Shopify requires 200 within 5s) and process
  // tiles in the background using Next.js after() for guaranteed completion.
  const response = NextResponse.json({
    status: 'accepted',
    orderId: order.id,
    orderNumber: order.order_number,
    customItemCount: customizedItems.length,
  });

  // Process in the background — after() guarantees completion even after response
  after(async () => {
    // ── Idempotency: skip if order already has print files ───────────
    if (SHOPIFY_STORE_DOMAIN && SHOPIFY_ADMIN_API_TOKEN) {
      try {
        const metafieldCheckUrl = `https://${SHOPIFY_STORE_DOMAIN}/admin/api/2024-01/orders/${order.id}/metafields.json?namespace=mosaiko&key=print_files`;
        const metafieldRes = await fetch(metafieldCheckUrl, {
          headers: { 'X-Shopify-Access-Token': SHOPIFY_ADMIN_API_TOKEN },
        });
        if (metafieldRes.ok) {
          const data = await metafieldRes.json();
          if (data.metafields?.length > 0) {
            console.log(
              `[webhook/shopify] Order ${order.order_number}: already processed (idempotency check), skipping`,
            );
            return;
          }
        }
      } catch (error) {
        // If idempotency check fails, proceed with processing (safe fallback)
        console.warn('[webhook/shopify] Idempotency check failed, proceeding:', error);
      }
    }

    const allPrintUrls: string[] = [];

    for (const item of customizedItems) {
      try {
        const urls = await processLineItem(order.id, item);
        allPrintUrls.push(...urls);
      } catch (error) {
        // Isolate errors per line item — continue processing remaining items
        console.error(
          `[webhook/shopify] Failed to process line item ${item.lineItemId} ` +
          `in order ${order.order_number}:`,
          error,
        );
      }
    }

    // Update order metafields with whatever tiles we successfully generated
    if (allPrintUrls.length > 0) {
      try {
        await updateOrderMetafields(order.id, allPrintUrls);
      } catch (error) {
        console.error(
          `[webhook/shopify] Failed to update metafields for order ${order.order_number}:`,
          error,
        );
      }
    }

    // Send email notifications
    const emailData = {
      orderNumber: String(order.order_number),
      customerEmail: order.email,
      items: customizedItems.map((item) => ({
        title: item.title,
        gridType: item.attrs['grid_type'] || 'Personalizado',
        quantity: item.quantity,
        previewImageUrl: item.attrs['preview_image_url'],
      })),
      printFileDownloadUrl: allPrintUrls.length > 0
        ? `${process.env.NEXT_PUBLIC_SITE_URL || ''}/admin/pedidos/${order.order_number}`
        : undefined,
    };

    try {
      await Promise.all([
        sendOrderConfirmation(emailData),
        sendAdminNotification(emailData),
      ]);
    } catch (emailError) {
      console.error(
        `[webhook/shopify] Failed to send emails for order ${order.order_number}:`,
        emailError,
      );
    }

    console.log(
      `[webhook/shopify] Order ${order.order_number}: processed ${allPrintUrls.length} print tiles, emails sent`,
    );
  });

  return response;
}
