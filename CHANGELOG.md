# Changelog

All notable changes to Mosaiko. Format inspired by [Keep a Changelog](https://keepachangelog.com).

## [Unreleased]

### Pending
- Phase 3.1: generate `ADMIN_PASSWORD_HASH` + `ADMIN_JWT_SECRET` for production
- Phase 3.2: local end-to-end smoke (cart → composite → Shopify checkout → webhook → tiles)
- Phase 4: Vercel team setup, `mosaiko.mx` domain registration, deploy
- Phase 5: Bogus Gateway test order (validates plumbing, no real money)
- Phase 6: Mercado Pago + low-value real test order
- Real-device iOS test for `useKeyboardInset` keyboard inset
- Shipping ETA reconciliation (cart copy 3–5 days, post-Resend the email is now native Shopify — confirm template wording)
- Rotate `SHOPIFY_CLIENT_SECRET` after integration test (visible in chat history)

---

## [Phase 0–2: Shopify integration & R2 → Shopify Files] — 2026-05-05

Branch: `chore/repo-polish`. Closes the multi-week "wire up Shopify" gate from Phase 2–6's `Pending` block. After this lands, the test-order phase has no remaining infra dependencies — only configuration and a real merchant account.

### Added

- **Live Shopify integration via `mosaiko-dev.myshopify.com`.** Mosaiko Backend custom app (Dev Dashboard, mosaiko-backend-4) with all required Admin + Storefront scopes installed; `Imanes Personalizados` product + 4 variants (200/280/360/480 MXN) created; variant GIDs wired into `SHOPIFY_VARIANT_MAP`.
- **OAuth client-credentials grant** (`getAdminAccessToken()` in `src/lib/shopify/client.ts`). The new Shopify Dev Dashboard does not expose static `shpat_*` tokens; we mint one on demand and cache it in module memory with a 60s safety margin before the 24h TTL. Concurrent callers coalesce onto a single in-flight mint via `pendingTokenFetch`. Backward-compat: `SHOPIFY_ADMIN_API_TOKEN` env still wins if set (tests + transitional dev).
- **`isAdminConfigured()` helper** that gates REST routes on either presence of static token OR client_id/secret pair without minting eagerly.
- **Shopify Files API primitives** (`src/lib/shopify/files.ts`). Batch-aware `uploadShopifyFilesBatch` does one `stagedUploadsCreate` for N inputs, parallel POSTs, one `fileCreate` with `duplicateResolutionMode: REPLACE`, then a batched `nodes(ids:[...])` poll with exp backoff (init 500 ms, cap 2 s, default 30 s timeout via `SHOPIFY_FILE_READY_TIMEOUT_MS`). On any failure, calls `bestEffortDelete(ids)` so Shopify Files never accumulates orphans — including the partial-IDs-with-userErrors case Codex flagged.
- **`resizeForShopifyFiles`** enforces the 20 MB / 20 MP Shopify limits via lazy `import('sharp')` (keeps the static graph client-safe so the catalog page bundle doesn't pull Sharp).
- **`parseShopifyFileBindingFromUrl`** in `pipeline-metafields.ts` — replaces `parseR2KeyFromPublicUrl`. Validates `u.origin === 'https://cdn.shopify.com'` (origin-strict, not hostname-only — defends against http downgrade and port confusion), parses `^/s/files/.../files/<filename>$`, then matches `^mosaiko-order-<X>-item-<Y>-tile-(\d+)(?:_[A-Za-z0-9-]{1,80})?\.png$`. The bounded suffix is defense-in-depth even with REPLACE.
- **Order tags as failure visibility** (`applyPipelineOrderTags(orderGid, status)`). `failed` → `print-pipeline-failed` tag; `partial` → `print-pipeline-partial`; `complete`/`empty` clears both. Best-effort (logs, doesn't roll back the metafield write). Wired into webhook + retry routes. `addOrderTags` / `removeOrderTags` mutations live in `src/lib/shopify/mutations/orders.ts`.
- **Live Shopify smoke test** (`scripts/smoke-shopify.mts`). Storefront query, Admin shop query, `stagedUploadsCreate`, `fileCreate` + READY poll, CDN HEAD reachability — all four checks GREEN as of 2026-05-05.
- **`ShopifyValues.md`** — secrets + GIDs + `.env.local` shape, gitignored.

### Changed

- **`src/lib/storage.ts` rewritten on Shopify Files** while preserving the legacy `bucket`/`key` public API. `uploadPrintTiles(jobId, tiles)` now goes through `uploadShopifyFilesBatch` and is atomic — partial-failure becomes `UploadFailure { succeeded: [], failed: [all tiles] }` (no orphan tiles thanks to in-primitive cleanup). `getPublicUrl(key)` THROWS to surface latent callers — there is no longer a deterministic key→URL mapping. `getObject` and `getSignedUrl` auto-flatten legacy `bucket/key` paths to the new flat filename.
- **Filename convention.** Print tiles: `mosaiko-order-<X>-item-<Y>-tile-<N>.png`. Originals: `mosaiko-original-<uuid>.<ext>`. Cart composites flatten via `mosaiko-print-files--cart-composites-<id>.png`. The convention encodes binding ids in the filename so the parser can defend the admin download against tampered metafields.
- **Composite-reuse bypass binding** (`webhook-processor.ts`). Stops deriving the composite URL from the key (no deterministic mapping post-Shopify-Files). Now reads `_composite_url` from the cart and binds it to `_composite_key` via `shopifyCdnUrlFilename(url) === compositeKey`. Mismatches fall through to the full pipeline.
- **Admin print-files route** drops the `getObject(key)` indirection. Validates URL binding via `parseShopifyFileBindingFromUrl`, then fetches the cdn.shopify.com URL directly.
- **SSRF allowlists tightened to `cdn.shopify.com` only.** Webhook, retry, generate-print, and cart-composite routes all dropped `r2.mosaiko.mx`.
- **`createFulfillment` rewritten for Shopify 2026-04 schema.** The 2024 `FulfillmentInput.orderId` field is gone; we now query `order(id) { fulfillmentOrders(first: 25) { ... } }` and pass `lineItemsByFulfillmentOrder` to `fulfillmentCreate`. `notifyCustomer: true` triggers Shopify's native shipping email — no Resend round-trip. Status route now returns 502 on fulfillment failure instead of swallowing the error and returning 200 (would have silently marked orders shipped without ever shipping).
- **`updateOrderMetafield` delegates to `setOrderMetafields`** (plural — the modern atomic upsert), and coerces a numeric REST id to a `gid://shopify/Order/<id>` automatically.
- **Catalog data split.** `src/lib/catalog-data.ts` is now pure-data (client-safe). Async merge helpers (`getAllProducts`, `getProductByIdAsync`) moved to `src/lib/catalog-data.server.ts` (`'server-only'`) so client components don't accidentally pull `storage.ts` + Sharp into the browser bundle.
- **API version bump** `2024-01` → `2026-04` across the codebase (`src/lib/shopify/client.ts` + four REST URLs).

### Removed

- **`@aws-sdk/client-s3`, `resend`** dropped from `package.json`. `src/lib/email/resend-client.ts` deleted entirely. Customer order confirmation now flows through Shopify's native order/payment notifications; admin failure visibility moved to order tags.
- **R2 hostnames** removed from SSRF allowlists. `R2_*` env vars stay as placeholders in `.env.local` until the next cleanup pass — they're no longer consumed.

### Codex audit findings (all addressed)

Pre-implementation review pushed back on six points: client-credentials over `APPEND_UUID` dedup; batched staged-uploads with `nodes(ids)` polling; best-effort cleanup on failure; drop `getObject` indirection; flat filename convention with binding regex; defer the JSON catalog migration. All incorporated into the design.

Post-implementation audit found 5 issues — all fixed in the same branch:

1. **HIGH** — `fulfillmentCreate` used the deprecated `orderId` field (broken on 2026-04); `updateOrderMetafield` used singular `metafieldSet` with a numeric id where a GID is required. Both rewritten as above.
2. **MEDIUM** — `shopifyCdnUrlFilename` accepted `http://cdn.shopify.com:8443/.../files/foo`. Now origin-strict + path-strict.
3. **MEDIUM** — `fileCreateBatch` could orphan IDs returned alongside `userErrors`. `bestEffortDelete` is now called on every error path before throw.
4. **MEDIUM** — `/api/generate-print` and `/api/cart-composite` SSRF allowlists still permitted `r2.mosaiko.mx`. Now Shopify-only.
5. **LOW** — Admin REST routes only honored `NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN`. Now also accept private `SHOPIFY_STORE_DOMAIN`.

### Verification

- `npm run build`: passes.
- `npm run test`: **150 / 150** (added 6 admin-print-files tests for the new parser).
- Live `scripts/smoke-shopify.mts` against `mosaiko-dev.myshopify.com`: all 4 checks green; `fileCreate` reached READY in 2.5 s.
- `npm run lint`: 17 errors, all pre-existing (React 19 strict-mode warnings on app/error pages — not introduced by this refactor).

---

## [Phase 2-6 + hot-fixes] — 2026-04-28

Squash-merged as PR #4 (`f9daaf3`). 32 commits, +5819/−613 lines across 52 files. Closes the post-pipeline-integrity work and ships every fix surfaced by the cumulative + post-push audits.

### Added

- **Cart-item detail view** (`/carrito/[itemId]`) — fridge-style mockup of the user's custom mosaic. Click any cart thumbnail to preview at 420 px max width with tile rotation + magnetic-shadow hover. Reuses the catalog's `<TileGrid>` component.
- **Shared `<TileGrid>` component** (`src/components/preview/TileGrid.tsx`) — extracted from `PredesignedPreview`. Renders a sprite composite into per-tile cells via `backgroundPosition`. Seam-aware for non-uniform grids. Used by both the catalog product detail page and the new cart-item detail page.
- **Durable filesystem-backed composite cache** (`.cart-composite-cache/`, gitignored) — replaces the in-memory `Map` that vanished on every dev-server restart. Atomic write (tmp + rename), `.mime` sidecar, mtime-based eviction, `safeResolve` path-containment guard.
- **Server-side font fidelity** via `@napi-rs/canvas` + 10 `@fontsource` WOFF2 packages. Spotify, Studio, Arte, and Save-the-Date now render in the brand font the user picked instead of falling back to DejaVu.
- **Composite-reuse bypass** — webhook splits the cart-composite PNG into print tiles when the cart-attribute `_composite_pipeline_version` matches `PIPELINE_VERSION`, skipping the second Sharp render at order time. Fail-closed on version mismatch or untrusted key.
- **Admin print-files R2 gate** — `/api/admin/print-files` now reads `print_pipeline_status` + `print_pipeline_results` metafields and gates downloads on `status === 'complete'`. Returns 409 + retry link for partial / failed orders.
- **Tonos `fitMode` end-to-end** — `'fill'` / `'fit'` / `'stretch'` correctly survive serializer → cart attributes → webhook → print pipeline → preview. `'fit'` shows cream letterbox in preview ↔ print.
- **`useKeyboardInset` hook** — visualViewport listener that lifts the sticky CTA + FAB above the iOS soft keyboard.
- **Per-slot Tonos cropper toolbar** — Restablecer + Cambiar foto buttons per slot via React-key remount + `resetSeq` counter.
- **Upload-step sticky CTA** — `PhotoUploader` exposes readiness via `onReadyChange` callback so the parent can drive advance.
- **Spotify geometry reconciliation** — measured template-PNG alpha bounds; cropAspect 1.0 → 1109/1152.
- **Operational scripts** — `scripts/cleanup-stale-metafields.mts` + `scripts/cleanup-orphan-r2-tiles.mts` (dry-run by default).
- **`SHOPIFY_SETUP.md`** — non-technical onboarding checklist for the client.

### Fixed

- **STD + Mosaicos cart thumbnails returning 4-tile placeholder** — root cause was lifetime mismatch between cart (persistent localStorage) and dev-mode blob storage (in-memory). Fix: filesystem-backed cache.
- **`font-loader` failure in Turbopack dev mode** — `createRequire(import.meta.url).resolve` was being statically rewritten by Turbopack into a synthetic asset reference that wasn't a real path. Fix: `path.join(process.cwd(), 'node_modules', ...)` (runtime call; bundlers can't transform).
- **Webhook silent photo-fetch drop** — `processLineItem` returned `string[]` so empty meant either "no tiles needed" or "fetch failed". Now returns `LineItemResult` discriminated union; admin email enumerates failures; idempotency gate respects per-line status.
- **R2 upload partial-state trap** — `Promise.all` would fail mid-upload, write partial URLs to metafield, and order-level idempotency would skip the retry forever. Fix: `Promise.allSettled` + `UploadFailure` thrown atomically; per-line idempotency.
- **Mosaicos `layoutRotated` dropped at serializer** — rotated 3-grid + 6-grid Mosaicos shipped unrotated. Fix: end-to-end propagation through `MosaicosCustomization.layoutRotated`.
- **Cart-attribute `grid_type` + `preview_image_url` filter drop** — webhook filter only kept `_`-prefixed attrs. Renamed both to `_grid_type` + `_preview_image_url` and updated readers (admin OrderCard, OrderDetailContent, email template).
- **Empty-cart resurrect after checkout** — `mosaiko_cart_id` cookie pointed at an old Shopify cart that re-hydrated on next page load. Fix: explicit cookie clear + sentinel.
- **Production data-URL fallback** — `uploadOrEncode` returning `data:` URLs on R2 failure could produce non-printable orders. Fix: throws in production, dev-only fallback retained.
- **Studio Japanese text falling back to DejaVu** — Noto Sans JP now bundled and registered explicitly.
- **`BLOB_ID_PATTERN` accepting `.` and `..`** — Codex audit MAJOR. Added `safeResolve(id)` containment guard.
- **Font-glob bloat** — `outputFileTracingIncludes` traced 1494 WOFF2 variants (~37 MB) per print route. Tightened to the 17 files actually registered (~1.28 MB).
- **Test environment leaks** — `process.env.R2_PUBLIC_URL` and `window.innerHeight` were modified without restoration in two tests. Now snapshot-and-restore in `beforeEach`/`afterEach`.

### Changed

- **Cart-store schema** — gained optional `compositeKey`, `compositeUrl`, `compositePipelineVersion` fields. Backward-compatible (all `?:` optional, defensive reads on hydrate).
- **`/api/admin/print-files`** — read API changed from R2-prefix listing to metafield-driven URL parsing via `parseR2KeyFromPublicUrl`. Caller passes Shopify order ID; route returns ZIP for all line items at once.
- **`listFiles`** in `src/lib/storage.ts` — now paginates via `ContinuationToken` (`ListObjectsV2` returns max 1000 keys per page).
- **`parity.test.ts`** migrated from `node:test` to `vitest`.

### Audit summary

- 7 BLOCKERs closed (webhook silent drop, R2 partial state, Tonos crash, metafield create-vs-upsert, non-atomic metafield order, zero-tile success, layoutRotated drop)
- 4 MAJORs closed (Tonos fitMode, composite reuse, font fidelity, admin R2 gate)
- 2 MINORs closed (attr naming, Studio CJK)
- 0 open findings
- 144/144 tests passing
- 2 rounds of Codex cumulative audit; ~5 rounds across per-phase audits
- All findings pinned by named vitest cases under `src/__tests__/integrity/`

---

## [Phase 1] — pre-2026-04

Initial storefront, builder, cart, admin, and Shopify scaffolding. Captured here only as the historical baseline; per-commit history available in git log.
