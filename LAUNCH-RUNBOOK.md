# Mosaiko — Launch Runbook (Phase 8)

Headless storefront (Next.js on Vercel) + "Shopify is the database". This runbook
executes the **irreversible** launch steps that Phase 7 deliberately deferred:
the domain cutover, the sales-channel migration, and the final real-payment
smoke. Every risky step is **canary-proven and reversible**. Run it top to
bottom; do not skip the canary in Step 3.

> Backend authority: Codex must review the channel-cutover (Step 3) and the
> Shopify primary-domain decision (Step 1/4) at execution time — the exact
> Shopify domain config for a Vercel-served apex has options that should be
> confirmed against current Shopify docs the day you cut over.

## Pre-flight
Run the read-only diagnostic and record the baseline:
```
npx tsx --env-file=.env.local scripts/diagnose-launch.mts
```
As of Phase 7 it reports: ORDERS_PAID webhook → `https://mosaiko.vercel.app/api/webhooks/shopify`
(api 2026-04); `read_publications` scope **MISSING**; v2 resolves via the
Storefront token with `onlineStoreUrl` set (Online-Store-published).

---

## Step 0 — Add Shopify Admin scopes (prerequisite)
Shopify admin → **Settings → Apps and sales channels → Develop apps → [the custom
app] → Configuration → Admin API access scopes** → add **`read_publications`** and
**`write_publications`** → Save → update the install. The next admin-token mint
(cold start) includes them. Re-run `diagnose-launch.mts` — publications now list,
and it prints which channels v2 is on.

## Step 1 — Domain: mosaiko.mx → Vercel
1. **Vercel** (project `mosaiko`): Settings → Domains → add `mosaiko.mx` (and `www`).
2. **Cloudflare** (Outer Haven account — where mosaiko.mx is registered): add the
   DNS records Vercel shows (apex `A`/`ALIAS`, `www` `CNAME`). Set the records to
   **DNS-only (grey cloud)** so Vercel terminates TLS. Wait for Vercel to verify +
   issue the certificate.
3. **Vercel env**: set `NEXT_PUBLIC_SITE_URL=https://mosaiko.mx` (Production) and
   redeploy → `robots.txt`, `sitemap.xml`, canonical + OG URLs all switch to the
   real domain automatically (see `src/lib/site-url.ts`).
4. **Shopify domain decision (confirm with Codex):** Shopify "connect existing
   domain" that *targets a custom storefront environment* is **Hydrogen-only** — it
   cannot point at our Vercel Next.js app. So `mosaiko.mx` serves the storefront
   **via Vercel DNS (step 2), not via Shopify**. Decide the Shopify-side surfaces:
   - **Checkout** stays on `shopify.com`/`*.myshopify.com` (current) unless you set
     up a checkout subdomain.
   - **Customer-account "back to store" link** follows Shopify's **primary domain**
     (see Step 4) — that's the only lever for where that hosted-page logo points.

## Step 2 — Webhook callback swap
Once mosaiko.mx serves the app: update the ORDERS_PAID subscription callback from
`mosaiko.vercel.app` → `https://mosaiko.mx/api/webhooks/shopify`. Edit
`scripts/subscribe-webhook.mts` `CALLBACK_URL`, re-run it (idempotent), and verify
with `diagnose-launch.mts`. Ensure exactly one active ORDERS_PAID subscription.

## Step 3 — Sales-channel cutover (canary-proven, REVERSIBLE)
Goal: stop `mosaiko-mx.myshopify.com` being a public duplicate storefront, WITHOUT
breaking the live Storefront price reads (a wrong move here = checkout fails closed
with PRICING_UNAVAILABLE — safe, but it's an outage). Order matters:
1. Confirm the **production Storefront token's channel** (the token the Vercel app
   uses, `NEXT_PUBLIC_SHOPIFY_STOREFRONT_TOKEN`). If it's a Headless/custom
   storefront token, products must be published to **that** channel.
2. **Publish** v2 (and every purchasable product) to the **Headless** channel.
   KEEP Online Store published for now.
3. **CANARY:** create an active product published **only** to Headless (not Online
   Store). Query it with the **exact production Storefront token** → it must resolve
   with `onlineStoreUrl: null`. This proves Headless-only reads work.
4. Query v2 + create a Storefront **cart for every priced variant** → confirm MXN
   subtotal + a working checkout URL.
5. **Only after 3 + 4 pass:** unpublish v2 (and others) from the **Online Store**
   channel. Do **not** archive/draft the product; do **not** remove it from the MX
   market.
6. **Verify immediately:** `/api/prices`, cart save, checkout URL, `onlineStoreUrl:
   null`, and no public product page at `mosaiko-mx.myshopify.com`.
- **ROLLBACK:** republish v2 to the Online Store; wait/purge the 60s price cache.
  (Checkout fails closed meanwhile — no mis-charge — because Phase 7 removed the
  legacy `SHOPIFY_VARIANT_MAP` fallback.)

## Step 4 — Customer-account link + Online Store lockdown
- The hosted customer-account page logo links to the Shopify **primary domain**
  (today `mosaiko-mx.myshopify.com`). To land users on the real site, either set
  the primary domain appropriately, OR publish a **redirect theme** on the Online
  Store that 302s `mosaiko-mx.myshopify.com` → `https://mosaiko.mx` (kills the
  duplicate storefront AND makes the logo land on the real site). Theme-only — no
  product-channel risk.
- Optionally password-protect the Online Store as defense in depth.

## Step 5 — Final real-payment smoke
- **Shopify Payments** card order (small, real) → confirm `ORDERS_PAID` fires →
  print pipeline runs → order tags clean (no `print-pipeline-failed`).
- **Mercado Pago OXXO/SPEI:** place an OXXO order → confirm it stays **PENDING** and
  the **print pipeline does NOT start** → on payment, `ORDERS_PAID` fires → pipeline
  runs. (Critical: print must never start on unpaid/pending.)
- Confirm customer + staff order emails (Shopify-native) arrive, branded + Spanish.

## Step 6 — Indexing go-live
- `curl https://mosaiko.mx/robots.txt` → allows, advertises the sitemap; `sitemap.xml`
  lists mosaiko.mx URLs (NEXT_PUBLIC_SITE_URL set).
- Submit the sitemap in **Google Search Console** for mosaiko.mx.
- Ensure `mosaiko.vercel.app` + `mosaiko-mx.myshopify.com` don't compete (the Step 4
  redirect + the preview-noindex middleware handle previews).

## Post-launch
- **Transfer mosaiko.mx** ownership to the client's Cloudflare account after the
  ~60-day registrar lock (currently in Outer Haven's Cloudflare; DNS already editable
  there, so this is an ownership handoff only).
- Deferred SHOULD/NICE (Codex pre-flight, intentionally out of Phase 7): GA4 wiring
  (needs the client's Measurement ID), admin login throttling/WAF, automated
  paid-order reconciliation job, dual-secret HMAC for secret rotation.

## Rollback summary
| Change | Rollback |
| --- | --- |
| Channel unpublish | Republish v2 to Online Store; purge 60s price cache |
| Domain | Revert `NEXT_PUBLIC_SITE_URL` + remove Vercel/Cloudflare records |
| Webhook | Re-point `CALLBACK_URL` to the working deployment, re-run script |
