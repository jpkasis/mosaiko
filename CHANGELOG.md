# Changelog

All notable changes to Mosaiko. Format inspired by [Keep a Changelog](https://keepachangelog.com).

## [Unreleased]

### Pending
- Connect Shopify store (waiting on client; see [`SHOPIFY_SETUP.md`](./SHOPIFY_SETUP.md))
- Real-device iOS test for `useKeyboardInset` keyboard inset
- Shipping ETA reconciliation (cart copy says 3-5 days, email says 5-10 days — needs product decision)

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
