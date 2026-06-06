# Deferred work

**Last updated:** 2026-06 (post-launch — store is **LIVE on mosaiko.mx**; see `CHANGELOG.md`).

`INTEGRITY_AUDIT.md` records **zero open BLOCKERs / MAJORs / MINORs** in the pipeline-integrity findings table. Everything below is intentionally scoped-out work that does NOT block the live store.

---

## Where we are right now

**LIVE.** The storefront runs on `mosaiko.mx` (Vercel) backed by `mosaiko-mx.myshopify.com`; Mercado Pago Checkout Pro is in production and a real order has been processed end-to-end (cart → composite → Shopify checkout → webhook → print tiles). Admin auth, the metaobjects content editor, and the Pedidos cancellation/refund view are all in production. Prices/variants read live from the `imanes-personalizados-v2` product; the order minimum is a fixed `MINIMUM_ORDER_MXN`. Image storage is Shopify Files; R2 + Resend are gone. Phases 0–8 are complete.

### Active deferred queue (post-launch, none blocking)
- **Re-enable image-retention PNG auto-delete** — built then reverted (`d585430`) to defer until provably safe; deleting customer files is irreversible. Re-enable: revert that commit → finish the Codex PR3 auth audit → read-only dry-run preview → arm `CRON_SECRET` only with owner sign-off.
- **Admin-editable order minimum** — the `MINIMUM_ORDER_MXN = 200` floor should become a `minimum_order` business-settings field (mirror the WhatsApp/TikTok chain).
- **GA4 analytics dashboard** embed in admin.
- **DMARC** TXT for `mosaiko.mx` (reported saved but not resolving authoritatively — re-check).
- **Cloudflare WAF** as the real rate-limit perimeter (the in-memory admin-login lockout is best-effort / per-instance).
- **Rotate `SHOPIFY_CLIENT_SECRET`** (visible in earlier chat history).
- Refund the remaining `Pagado` test orders; OXXO/SPEI live-payment smoke; de-index the `*.myshopify.com` surface.

### Real-device iOS test for `useKeyboardInset`

The Phase 6.1 `useKeyboardInset` hook (lifts the sticky CTA + FAB above the iOS soft keyboard) is unit-tested via a fake `visualViewport`, but DevTools cannot simulate iOS Safari's keyboard. Needs a hands-on pass on:
- iPhone Safari
- iPhone Chrome
- Android Chrome

Look at the `customize` step (STD / Arte / Studio / Spotify text inputs) — confirm the sticky CTA stays above the keyboard when an input gains focus.

### Shipping ETA inconsistency (product decision)

**Where:** Cart drawer + `/carrito` say `Estándar · 3–5 días hábiles`. The Resend email is gone; the customer-facing email is now whatever Shopify's native order-confirmation template says (Shopify Admin → Settings → Notifications → Order confirmation).

**Decision needed:** which window is true? Once chosen, standardize across:
- Cart drawer + `/carrito` page copy
- Shopify-native order-confirmation template body
- Order-confirmation page (`/pedido-confirmado`)
- FAQ "shipping" section if present

### Admin "Fallidos" tab/badge on /admin/pedidos

**What:** Phase 2 wired `print-pipeline-failed` / `print-pipeline-partial` order tags via `applyPipelineOrderTags`. The tag drives Shopify Admin filtering, but the local admin panel at `/admin/pedidos` doesn't yet surface a "Fallidos" tab or count badge.

**Effort:** Low. Filter the Admin orders query by tag membership, show a count + tab.

---

## Long-tail roadmap (post-launch)

These never blocked the merge; they're the natural next phases the client may want once the storefront is live and generating signal.

### Customer order-tracking page

**What:** `/pedido/[orderNumber]` public page where a buyer enters their email + order number and sees fulfillment status + tracking.

**Path forward:** Shopify provides this OOTB via hosted customer accounts (passwordless email-code sign-in, order history). Use Shopify's hosted accounts first; only build a custom page if branded UX becomes a marketing priority.

### Admin: retry UI for failed pipeline lines

**What:** The retry-line endpoint (`POST /api/admin/orders/[orderId]/retry`) exists and is tested. The admin order-detail page doesn't yet have a "Retry failed line" button.

**Effort:** Low — single button per failed line, calls the existing endpoint, refreshes the page.

### Admin: fulfillment + tracking entry

**What:** Admin needs to mark orders shipped + paste a tracking number. The `setOrderMetafields` mutation handles writes; the order pipeline already has a `notifyCustomer: true` hook for the shipping email.

**Effort:** Medium — a small form on the order detail page, plus a test of the customer-facing email.

### Admin: settings / health-check page

**What:** A page that surfaces "is everything wired correctly?":
- Shopify Storefront reachable (`shopifyFetch` shop query)
- Shopify Admin reachable (`shopifyAdminFetch` shop query — exercises the client-credentials grant)
- Shopify Files reachable (`stagedUploadsCreate` for a 1-byte payload, no `fileCreate`)
- Webhook secret matches Shopify (HMAC self-test)
- All required env vars present (`SHOPIFY_CLIENT_ID`, `SHOPIFY_CLIENT_SECRET`, `SHOPIFY_VARIANT_MAP`, etc.)

**Effort:** Low. High value for the client to self-serve diagnose during onboarding.

### Admin: products CRUD polish

**What:** Predesigned product catalog (`src/lib/catalog-data.ts` today is hardcoded). Move to Shopify metaobjects so the client can edit names / images / prices without a deploy.

**Effort:** Medium. Requires Shopify metaobject schema + admin UI + read-fallback to the hardcoded data while migrating.

### GA4 analytics dashboard

**What:** Embed Google Analytics 4 events for the conversion funnel (home → builder → cart → checkout). Surface key metrics on the admin dashboard.

**Effort:** Low for events; medium for the embed.

### Content pages polish (About / FAQ / Contact / legal)

**What:** Apply the mobile-rulebook (typography, spacing, touch-target floor) to the non-funnel content pages. Phase 6 explicitly scoped these out — conversion funnel first.

**Effort:** Low per page.

### Hero mosaic tile alignment bug

**Where:** Memory note `hero_tile_bug.md` (resolved). Listed for completeness — already fixed.

---

## Operational cleanup tasks (manual, low-effort)

### Stale historical metafields (pre-pipeline-integrity)

**Symptom:** Orders processed before the `metafieldsSet` upsert pattern landed may carry duplicate `(mosaiko, key)` rows from the legacy `POST /metafields.json` create loop.

**Tool:** `scripts/cleanup-stale-metafields.mts` (dry-run by default, `--apply` to delete via REST DELETE-by-ID; `--days=N` to scope window).

**Urgency:** Low — every subsequent webhook upsert overwrites correctly; duplicates only matter if a future reader does prefix listing instead of exact `(namespace, key)` lookup.

### Orphaned R2 tiles (pre-Phase-2 partial uploads)

**Status as of 2026-05-05:** R2 is no longer the storage backend. Print tiles now live on Shopify Files via `duplicateResolutionMode: REPLACE`, and the batched `uploadShopifyFilesBatch` does best-effort `fileDelete` cleanup on every failure path. Orphans should be near-zero going forward.

**Tool:** `scripts/cleanup-orphan-r2-tiles.mts` is now historical — useful only if the legacy R2 bucket still has data when access is finally revoked.

**Urgency:** Very low. Pre-migration R2 contents will be deleted with the bucket when R2 access is rotated off.

### Drop the `R2_*` env-var placeholders

**Symptom:** `.env.local` still has `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, etc. as placeholders even though no code path consumes them anymore.

**Effort:** Trivial — clean up in the next env audit.

**Urgency:** Low. They're harmless placeholders; just visual noise.

---

## Indefinitely deferred

- **Admin panel mobile UX** — `CLAUDE.md` declares admin desktop-primary. No action planned unless the client requests it.
- **Visual redesign of existing components** — scope cap from Phase 6 was "polish + selective restructure," not redesign. The mobile-design rulebook codified spacing/typography/motion/touch rules; aesthetic was intentionally preserved.
- **Custom buyer auth** — Shopify customer accounts cover this OOTB. Don't build duplicate auth.

---

## Codex observations (context only, not action items)

These came out of audits during the merged phases. Keeping them here so the next agent has the full picture:

- **Shopify Files retry overwrite is logically safe.** With `duplicateResolutionMode: REPLACE`, retrying the same `(orderId, lineItemId, tile-N)` overwrites in place — no orphans, no dedup suffix, no stale state. Codex specifically recommended this over `APPEND_UUID`.
- **Shopify Admin API version (2026-04 as of this writing)** is bumped via the `SHOPIFY_API_VERSION` constant in `src/lib/shopify/client.ts`. Bump again on the next maintenance pass when 2026-04 ages out of support.
- **Retry endpoint vs concurrent webhook race.** If Shopify fires a duplicate webhook AND an admin clicks retry at the same time, both call `metafieldsSet`. The atomic mutation prevents corruption, but last-write-wins. In practice both converge on the same result because they read the same prior state.
- **`after()` is not a durable job queue.** The webhook responds 200 in <5s and runs the print pipeline in the background via Next's `after()`. Inside Vercel this is fine (function timeout 300s gives ample headroom for 9-tile orders). If we ever move off Vercel, we'd need a real queue. Add a reconciliation cron that retries `print_pipeline_status='partial'` orders if real-world failure rates surface.
- **Shopify Files limits are 20 MB / 20 MP.** `resizeForShopifyFiles` enforces ≤ 15 MB / ≤ 16 MP via Sharp. iPhone 15+ / Samsung S24+ shoot >20 MP often; this matters.
- **Shopify external-provider fee on Mercado Pago: 2% on Basic.** Combined with Mercado Pago's processor fee (~3.49% + $4 MXN cards), the all-in transaction cost is ~5.49% + $4 MXN. Worth the cost conversation with the client; Grow ($55/mo) drops the external-provider fee to 1%.
