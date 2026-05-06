# Shopify integration setup

A non-techy walkthrough of what the Mosaiko store owner needs to do to connect the Mosaiko app to a real Shopify backend. Once these steps are done, the dev team runs one low-value real-money test order end-to-end (Phase 6 of the launch plan) to validate everything wires together.

> **Architecture context:** Mosaiko uses Shopify as its database. Orders, customers, payments, fulfillment, inventory, AND image storage all live in Shopify. The custom Next.js app handles the photo builder, cart, and print pipeline; Shopify-hosted checkout handles payment (Mercado Pago: cards / OXXO / SPEI). Shopify Files (the CDN that backs Files API) holds every uploaded photo, every cart-composite preview, and every print-ready tile. There is no separate Cloudflare R2 bucket and no separate Resend inbox to maintain.

> **Status as of 2026-05-05:** the dev store `mosaiko-dev.myshopify.com` is connected end-to-end. The four steps below describe what the production store needs once the client picks a Shopify plan.

---

## Step 1 — Create the Shopify store

1. Go to [shopify.com](https://www.shopify.com) and start a new store. Pick the country **México**, currency **MXN**, language **Spanish**.
2. Choose the **Basic** plan ($14 USD/mo annual, ~$39 USD/mo monthly). Verify the price at the Mexican checkout — Shopify sometimes charges in MXN with a different ratio.
3. The store domain (e.g. `mosaiko.myshopify.com`) is what the dev team needs. Custom domains (`mosaiko.mx`) are added in Vercel + Cloudflare later.

## Step 2 — Create the product

Mosaiko sells one product with four variants (one per grid size). The Shopify admin will use these variant IDs to know which size the buyer picked.

1. **Products → Add product**
2. **Title:** `Imanes Personalizados`
3. **Variants** — go to the Variants section and add four:

   | Tamaño   | Precio (MXN) |
   |----------|--------------|
   | 3 piezas | 200          |
   | 4 piezas | 280          |
   | 6 piezas | 360          |
   | 9 piezas | 480          |

   (Adjust prices to match `src/lib/grid-config.ts` if they change.)
4. **Inventory:** set "Track quantity" to **off** for all variants — Mosaiko is made-to-order, not stocked.
5. **Save**. Open each variant's URL — the URL ends in a numeric ID (e.g. `.../variants/55035217576227`). Send those four IDs to the dev team; they go into `SHOPIFY_VARIANT_MAP`.

## Step 3 — Create the Mosaiko Backend custom app

The new Shopify Dev Dashboard replaces the old "store admin → Develop apps" flow. There is no longer a static `shpat_*` token to copy; the Mosaiko code mints one on demand using the OAuth client-credentials grant.

1. Go to [Shopify Partners → Dev Dashboard](https://partners.shopify.com/) → **Apps → Create app → Custom distribution → install on `mosaiko.myshopify.com`**. Name it `Mosaiko Backend`.
2. **Crear versión.** In `Configuración del cliente`, set the Admin API access scopes:
   - `read_orders`, `write_orders`
   - `read_customers`, `write_customers`
   - `read_products`, `write_products`
   - `read_fulfillments`, `write_fulfillments`
   - `read_metaobject_definitions`, `write_metaobject_definitions`
   - `read_metaobjects`, `write_metaobjects`
   - `read_files`, `write_files`
3. Storefront API access scopes:
   - `unauthenticated_read_product_listings`
   - `unauthenticated_write_checkouts`
   - `unauthenticated_read_checkouts`
4. **Publicar la versión** → **Instalar app** on the production store. Click through the consent dialog.
5. Open the app's `Configuración → Cliente` tab. Copy:
   - **Client ID** (looks like a 32-char hex: `8bb55ac5b816e77b15c37c66b72d4224`)
   - **Client Secret** (eye icon to reveal; starts with `shpss_`)

   Send both to the dev team. They go into env vars as `SHOPIFY_CLIENT_ID` + `SHOPIFY_CLIENT_SECRET`. **The Client Secret doubles as the webhook HMAC signing key in this model**, so the same value goes into `SHOPIFY_WEBHOOK_SECRET`.

## Step 4 — Create the webhook

1. **Settings → Notifications → Webhooks** in store admin.
2. **Create webhook:**
   - Event: `Order payment`
   - Format: `JSON`
   - URL: `https://<vercel-url>/api/webhooks/shopify` (dev team provides the URL after deployment)
   - API version: `2026-04` (or latest stable at the time)
3. Webhooks created via the Dev Dashboard inherit the app's Client Secret as the HMAC signing key — there is no separate per-webhook secret to copy. (If you create the webhook outside the Dev Dashboard via the legacy admin UI, copy the per-webhook signing secret instead.)

## Step 5 — Mercado Pago payment processor

1. **Apps → Mercado Pago** in the Shopify App Store. Install + connect the merchant's Mercado Pago account.
2. **Settings → Payments**: set Mercado Pago as the primary processor (cards + OXXO + SPEI).
3. Note: Shopify charges a **2% external-provider fee** on Basic when using Mercado Pago (or any processor that isn't Shopify Payments). Combined with Mercado Pago's processor fee (~3.49% + $4 MXN cards), all-in is ~5.49% + $4 MXN per card transaction. Worth surfacing in the cost conversation.

## Step 6 — Customize Shopify-native emails

The Mosaiko app does NOT send transactional email — Shopify does it natively.

1. **Settings → Notifications**: customize the Liquid templates for:
   - Order confirmation (sent automatically when payment lands)
   - Shipping confirmation (sent when admin marks fulfillment shipped)
2. Confirm "staff order notification" recipient is the merchant's own email so they get a heads-up on every order.
3. Brand the templates with the Mosaiko logo + Spanish copy. The dev team can help.

## Step 7 — Send everything to the dev team

The dev team needs:

```
SHOPIFY_STORE_DOMAIN=<mosaiko.myshopify.com>
SHOPIFY_CLIENT_ID=<from step 3>
SHOPIFY_CLIENT_SECRET=<from step 3>
SHOPIFY_WEBHOOK_SECRET=<same value as SHOPIFY_CLIENT_SECRET in this model>
SHOPIFY_VARIANT_MAP={"3":"gid://shopify/ProductVariant/...","4":"gid://shopify/ProductVariant/...","6":"gid://shopify/ProductVariant/...","9":"gid://shopify/ProductVariant/..."}
NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN=<mosaiko.myshopify.com>
NEXT_PUBLIC_SHOPIFY_STOREFRONT_TOKEN=<dev team mints this from the Storefront API>
ADMIN_PASSWORD_HASH=<bcrypt hash of the chosen admin-panel password — dev team generates>
ADMIN_JWT_SECRET=<32-byte random string — dev team generates>
ADMIN_NOTIFICATION_EMAIL=<merchant's email>
```

There is no longer a Cloudflare R2 setup or a Resend setup — Shopify Files + Shopify Notifications cover both.

## Step 8 — Test order

The dev team runs:
1. **Bogus Gateway test order** (Shopify-simulated processor, no real money) to validate plumbing.
2. **Real low-value Mercado Pago test order** (~1–5 MXN) to validate the live payment flow. Refunded immediately after.

Validation checklist:
- Cart attributes round-trip into Shopify ✓
- Webhook fires and HMAC validates ✓
- Sharp pipeline produces the right tiles ✓
- Tiles upload to Shopify Files; URLs land in order metafields ✓
- Admin panel sees the order with downloadable print files ✓
- Customer + staff order-confirmation email arrive via Shopify-native ✓
- (If admin marks shipped) shipping email arrives via Shopify-native ✓

Once both pass, the store is ready to go live.

---

## Common gotchas

- **Webhook HMAC = the Client Secret in the Dev Dashboard model.** Don't paste a separate value; reuse the same `shpss_…` from the Configuración tab.
- **`SHOPIFY_VARIANT_MAP` is a JSON string, not a JSON object.** It's read from `process.env` so it must be one line: `{"3":"...","4":"..."}`.
- **The Client Secret is sensitive.** It's the only thing standing between us and full Admin API access. After integration test, rotate it (Configuración → Secreto → "Rotar") and update the env vars.
- **Shopify Files has a 20 MB / 20 MP cap per image.** Modern phones can shoot >20 MP; the Mosaiko code pre-resizes via Sharp before upload, so this is automatic, but be aware.

---

## What the buyer experience looks like

1. Buyer lands at `mosaiko.mx`, picks a category, uploads a photo, crops, customizes, adds to cart.
2. Cart drawer + `/carrito` show the assembled magnet preview (served from Shopify Files via cdn.shopify.com).
3. Click "Pagar" → redirected to Shopify-hosted checkout (yours, branded).
4. Shopify processes the payment via Mercado Pago (OXXO / SPEI / card).
5. After payment confirmation, Shopify fires the `orders/paid` webhook to Mosaiko.
6. Mosaiko's print pipeline assembles per-tile PNGs, uploads them to Shopify Files, writes URLs back to the order as Shopify metafields. On any per-line failure, an order tag (`print-pipeline-failed` or `print-pipeline-partial`) lights up in Shopify Admin's order list so the merchant sees it next time they open that view.
7. Customer + merchant get Shopify-native email notifications.
8. Merchant opens `/admin/pedidos/<order>`; downloads the ZIP of print-ready tiles; prints + ships.
9. Merchant marks the order "shipped" with a tracking number — Mosaiko calls Shopify's `fulfillmentCreate` mutation with `notifyCustomer: true` so Shopify sends the native shipping email.

That's it. No separate database; no separate inbox; no third-party storage account. Shopify is the source of truth.

---

For deeper integration questions, the dev team's reference is:
- `src/lib/shopify/` — Storefront + Admin API clients, cart mutations, webhook parser, files API
- `src/app/api/webhooks/shopify/route.ts` — webhook handler
- `src/app/api/cart-composite/route.ts` — preview/print composite generator
- `INTEGRITY_AUDIT.md` — full audit report for the data flow
- `CHANGELOG.md` — what changed and when (most recent: Phase 0–2 Shopify integration, 2026-05-05)
