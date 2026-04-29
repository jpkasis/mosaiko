# Deferred work

State of `main` after the Phase 2–6 + hot-fixes squash-merge (PR #4 → `f9daaf3`, 2026-04-28).

`INTEGRITY_AUDIT.md` records **zero open BLOCKERs / MAJORs / MINORs** in the pipeline-integrity findings table. Everything below is intentionally scoped-out work that does NOT block production launch — most of it is waiting on the Shopify connection or the client's product decisions.

**Last updated:** 2026-04-29

---

## Waiting on the client (external dependencies)

### 1. Shopify store + env vars

The single biggest blocker to going live. Without it, no real order can flow through the integration.

**What the client needs to provide:**
- Shopify store domain (e.g. `mosaiko.myshopify.com`)
- One product `Imanes Personalizados` with 4 variants (3 / 4 / 6 / 9 piezas)
- Custom Shopify app with scopes: `read_orders`, `write_orders`, `read_customers`, `write_metaobjects`, `write_files`
- Webhook subscription: `orders/paid` → `https://<vercel-url>/api/webhooks/shopify`
- Env vars (Vercel + `.env.local`): see `SHOPIFY_SETUP.md` for the full list.

**Status:** Not a development task — all the code paths that consume these vars are shipped and tested against fixtures. Once values land, run one $0.01 test order end-to-end.

### 2. Real-device iOS test for `useKeyboardInset`

The Phase 6.1 `useKeyboardInset` hook (lifts the sticky CTA + FAB above the iOS soft keyboard) is unit-tested via a fake `visualViewport`, but DevTools cannot simulate iOS Safari's keyboard. Needs a hands-on pass on:
- iPhone Safari
- iPhone Chrome
- Android Chrome

Look at the `customize` step (STD / Arte / Studio / Spotify text inputs) — confirm the sticky CTA stays above the keyboard when an input gains focus.

### 3. Shipping ETA inconsistency (product decision)

**Where:** Cart drawer + `/carrito` say `Estándar · 3–5 días hábiles`; order-confirmation email (`src/lib/email/resend-client.ts:105`) says `5 a 10 días hábiles`.

**Decision needed:** which window is true? Once chosen, standardize across:
- Cart drawer + `/carrito` page copy
- Order-confirmation email body
- Order-confirmation page (`/pedido-confirmado`)
- FAQ "shipping" section if present

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
- Shopify reachable (Storefront + Admin API ping)
- R2 reachable (HEAD on a known key)
- Resend reachable (validate API key)
- Webhook secret configured
- All required env vars present

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

### Orphaned R2 tiles (pre-fix partial uploads)

**Symptom:** Before BLOCKER #2 was fixed (Phase 4 `Promise.allSettled` + `UploadFailure`), a partial `Promise.all` failure could leave tiles in R2 with no metafield reference. Storage is cheap; deterministic-key retries overwrite eventually.

**Tool:** `scripts/cleanup-orphan-r2-tiles.mts` (dry-run by default, `--apply` to delete). Fail-closed on canonical-URL parse failure (a Codex catch — without this, live tiles could be misclassified as orphans). **Run AFTER `cleanup-stale-metafields.mts`** so the canonical metafield row is unambiguous.

**Urgency:** Very low.

---

## Indefinitely deferred

- **Admin panel mobile UX** — `CLAUDE.md` declares admin desktop-primary. No action planned unless the client requests it.
- **Visual redesign of existing components** — scope cap from Phase 6 was "polish + selective restructure," not redesign. The mobile-design rulebook codified spacing/typography/motion/touch rules; aesthetic was intentionally preserved.
- **Custom buyer auth** — Shopify customer accounts cover this OOTB. Don't build duplicate auth.

---

## Codex observations (context only, not action items)

These came out of audits during the merged phases. Keeping them here so the next agent has the full picture:

- **R2 overwrite on retry is logically safe** when inputs are immutable and Sharp renders are deterministic. Cost is one extra PUT + Sharp pass per retry — acceptable.
- **Shopify Admin REST API is legacy.** The hardcoded `2024-01` in `shopifyAdminFetch` should be bumped on a maintenance pass; not urgent.
- **Retry endpoint vs concurrent webhook race.** If Shopify fires a duplicate webhook AND an admin clicks retry at the same time, both call `metafieldsSet`. The atomic mutation prevents corruption, but last-write-wins. In practice both converge on the same result because they read the same prior state.
