# Shopify integration setup

A non-techy walkthrough of what the Mosaiko store owner needs to do to connect the Mosaiko app to a real Shopify backend. Once these steps are done, the dev team runs one $0.01 test order end-to-end to validate everything wires together.

> **Architecture context:** Mosaiko uses Shopify as its database. Orders, customers, payments, fulfillment, and inventory all live in Shopify. The custom Next.js app handles the photo builder, cart, and print pipeline; Shopify-hosted checkout handles payment (OXXO, SPEI, cards). No separate database to maintain.

---

## Step 1 — Create the Shopify store

1. Go to [shopify.com](https://www.shopify.com) and start a new store. Pick the country **México**, currency **MXN**, language **Spanish**.
2. The store domain (e.g. `mosaiko-mx.myshopify.com`) is what the dev team needs. Custom domains (`tienda.mosaiko.mx`) can be added later once Vercel is live.

## Step 2 — Create the product

Mosaiko sells one product with four variants (one per grid size). The Shopify admin will use these variant IDs to know which size the buyer picked.

1. **Products → Add product**
2. **Title:** `Imanes Personalizados`
3. **Description:** anything reasonable; not user-facing in our flow.
4. **Variants** — go to the Variants section and add four:
   | Option | Value | Price (MXN) |
   |---|---|---|
   | Tamaño | 3 piezas | 240 |
   | Tamaño | 4 piezas | 320 |
   | Tamaño | 6 piezas | 360 |
   | Tamaño | 9 piezas | 480 |

   (Adjust prices to match the live `grid-config.ts` values. Dev team will reconcile if needed.)

5. **Inventory:** set "Track quantity" to **off** for all variants — Mosaiko is made-to-order, not stocked.
6. **Save**. After saving, click each variant and copy its **Variant ID** (the GID — `gid://shopify/ProductVariant/<numeric_id>` in the URL). Send these to the dev team — they go into `SHOPIFY_VARIANT_MAP`.

## Step 3 — Create a custom Shopify app

Custom apps are how Shopify exposes its API to external services (i.e., Mosaiko's Next.js backend).

1. **Settings → Apps and sales channels → Develop apps → Allow custom app development → Create an app**
2. **App name:** `Mosaiko Backend`
3. **Configure Admin API scopes** — grant these:
   - `read_orders`, `write_orders`
   - `read_customers`, `write_customers`
   - `read_products`, `write_products`
   - `read_fulfillments`, `write_fulfillments`
   - `read_metaobject_definitions`, `write_metaobject_definitions`
   - `read_metaobjects`, `write_metaobjects`
   - `write_files`
4. **Configure Storefront API scopes** — grant these:
   - `unauthenticated_read_product_listings`
   - `unauthenticated_write_checkouts`
   - `unauthenticated_read_checkouts`
5. **Save → Install app** (click through the consent dialog).
6. After install, go to **API credentials** and copy:
   - `Admin API access token` (starts with `shpat_`)
   - `Storefront API access token`
   - `API secret key` (used for webhook HMAC validation later)

   Send all three to the dev team — they go into env vars.

## Step 4 — Create the webhook

1. **Settings → Notifications → Webhooks**
2. **Create webhook:**
   - Event: `Order payment`
   - Format: `JSON`
   - URL: `https://<vercel-url>/api/webhooks/shopify` (dev team provides the Vercel URL)
   - API version: latest stable
3. After saving, Shopify shows a **Signing secret**. Copy it — that's `SHOPIFY_WEBHOOK_SECRET` for the env vars. (HMAC validation rejects forged webhooks.)

## Step 5 — Send everything to the dev team

The dev team needs all of the following to plug into Vercel + the local `.env.local`:

```
# Shopify
SHOPIFY_STORE_DOMAIN=mosaiko-mx.myshopify.com
SHOPIFY_STOREFRONT_TOKEN=<from step 3>
SHOPIFY_ADMIN_TOKEN=<from step 3, starts with shpat_>
SHOPIFY_WEBHOOK_SECRET=<from step 4>
SHOPIFY_VARIANT_MAP={"3":"gid://shopify/ProductVariant/...","4":"gid://shopify/ProductVariant/...","6":"gid://shopify/ProductVariant/...","9":"gid://shopify/ProductVariant/..."}

# Cloudflare R2 (image storage)
R2_ACCOUNT_ID=<from Cloudflare dashboard>
R2_ACCESS_KEY_ID=<from Cloudflare R2 → Manage API tokens>
R2_SECRET_ACCESS_KEY=<from Cloudflare R2 → Manage API tokens>
R2_PUBLIC_URL=https://r2.mosaiko.mx (custom domain you bind to the bucket)

# Resend (transactional email)
RESEND_API_KEY=<from resend.com dashboard>

# Admin auth (one admin user for the panel)
ADMIN_PASSWORD_HASH=<bcrypt hash of the chosen password — dev team can generate>
ADMIN_JWT_SECRET=<32-byte random string — dev team generates>
```

## Step 6 — Test order

The dev team will run one $0.01 test order end-to-end to validate:
- Cart attributes round-trip into Shopify
- Webhook fires and HMAC validates
- Sharp pipeline produces the right tiles
- R2 receives the tiles
- Admin panel sees the order with downloadable print files
- Customer + admin notification emails arrive via Resend

Once that passes, the store is ready to go live (point a custom domain at Vercel).

---

## Common gotchas

- **Webhook HMAC validation rejects forged requests.** Make sure the signing secret matches between Shopify and the env var exactly — leading/trailing whitespace will silently fail.
- **`SHOPIFY_VARIANT_MAP` is a JSON string, not a JSON object.** It's passed through `process.env` so it must be one line: `{"3":"...","4":"..."}`.
- **R2 public URL must be HTTPS and CORS-enabled** so the browser can load thumbnails. Bind a Cloudflare custom domain (cleanest path) or use the bucket's default `*.r2.dev` URL during testing.
- **Resend's "from" address must use a verified domain** before the email actually delivers. Use `noreply@mosaiko.mx` once the domain is verified in Resend; until then, transactional emails will be rate-limited by Resend's anti-abuse layer.

---

## What the buyer experience looks like

1. Buyer lands at `mosaiko.mx`, picks a category, uploads a photo, crops, customizes, adds to cart.
2. Cart drawer + `/carrito` show the assembled magnet preview.
3. Click "Pagar" → redirected to Shopify-hosted checkout (yours, branded).
4. Shopify processes the payment (OXXO / SPEI / card).
5. After payment confirmation, Shopify fires the `orders/paid` webhook to Mosaiko.
6. Mosaiko's print pipeline assembles per-tile PNGs, uploads to R2, writes URLs back to the order as Shopify metafields.
7. Admin gets a notification email; opens `/admin/pedidos/<order>`; downloads the ZIP of print-ready tiles.
8. Admin prints + ships; marks the order "shipped" with a tracking number.
9. Buyer gets a shipping email via Resend.

That's it. No separate database to maintain; Shopify is the source of truth.

---

For deeper integration questions, the dev team's reference is:
- `src/lib/shopify/` — Storefront + Admin API clients, cart mutations, webhook parser
- `src/app/api/webhooks/shopify/route.ts` — webhook handler
- `src/app/api/cart-composite/route.ts` — preview/print composite generator
- `INTEGRITY_AUDIT.md` — full audit report for the data flow
