# Pipeline Integrity Audit

**Scope:** builder → `/api/cart-composite` → cart store → Shopify cart-attribute JSON → Shopify hosted checkout → Shopify order webhook → `processPrintJob` → Sharp pipeline → `uploadPrintTiles` → R2 → admin email → tile ZIP.

**Goal:** confirm every piece of user-designed data (photo, crop, category, grid, text, effects, Tonos tones + fit mode + rotation, Arte info tile, Studio text panels, Spotify bar, Polaroid frame) faithfully survives the chain to the PNG tiles the admin downloads for printing.

**Methodology:**
- Paired codebase audit (Explore agent + Codex) on `fix/cart-display-and-print-shape` ancestry.
- Fixture-based vitest suite under `src/__tests__/integrity/` — every finding pinned as a named test.
- Dependency-injected orchestrator + mock + captured-fixture webhook payloads; no live Shopify, no live R2.

**Status:** Fully landed on `main` (PR #4 squash-merged as `f9daaf3` on 2026-04-28).

**Last updated:** 2026-04-29 — repo polish + docs sweep. All audit findings closed. Branch state captured below.

**Audit history:**
- Phase 2 (Tonos `fitMode`) — closes MAJOR #8.
- Phase 3 (cart correctness: composite-reuse + attr naming + safety) — closes MAJOR #9 + MINOR #12.
- Phase 4 (server-side font fidelity: `@napi-rs/canvas` + `@fontsource` WOFF2s) — closes MAJOR #10 + MINOR #13.
- Phase 5 (admin print-files metafield-driven gate) — closes MAJOR #11.
- Phase 6 (mobile polish: `useKeyboardInset`, Tonos slot toolbar, upload-step sticky CTA).
- Pre-push cumulative audit — caught 1 MAJOR (font-glob bloat 37 MB → 1.28 MB), 1 LOW (test env-leak), 2 NITs; all fixed.
- Post-push hot-fixes: font-loader Turbopack dev-mode resolution; Spotify geometry reconciliation (cropAspect 1.0 → 1109/1152 from measured template PNGs).
- Cart-thumbnail durability fix — durable filesystem-backed composite cache + new `/carrito/[itemId]` detail view + shared `<TileGrid>` extracted from catalog. 2 rounds of Codex audit caught 1 MAJOR (`.` / `..` path traversal in `BLOB_ID_PATTERN`) + 1 LOW (hydration race), both fixed.

**Zero open BLOCKERs / MAJORs / MINORs.** Remaining items in `DEFERRED.md` are external (Shopify store creation by client, real-device iOS test, shipping-ETA product decision) or post-launch roadmap (admin retry UI, fulfillment entry, GA4, content-pages polish).

---

## Findings — severity-sorted

| # | Severity | Title | Status | Evidence / Test |
|---|---|---|---|---|
| 1 | **BLOCKER** | Webhook swallows photo-fetch failure → paid order ships with no tiles, admin email suggests success, idempotency gate skips retry | **FIXED — Phase 3** | `webhook-failure-modes.test.ts` §"BLOCKER #1 — webhook photo-fetch silent drop (post-fix behaviour)" (8 tests) |
| 2 | **BLOCKER** | R2 upload partial-state + order-level idempotency trap — partial URLs written, retry skipped forever | **FIXED — Phase 4** | `webhook-failure-modes.test.ts` §"BLOCKER #2 — uploadPrintTiles partial-state" + §"Phase 4 fix" (4 tests) |
| 3 | **BLOCKER** | `processTonos` crashes on `intensity='strong'` — Sharp rejects non-integer `hue: 22.5` | **FIXED — Phase 4b** | `processor-contract.test.ts` §"tonos intensity=\"strong\" no longer crashes" |
| 4 | **BLOCKER** | Metafield write is CREATE not UPSERT (`POST /metafields.json`) — repeated retries accumulate duplicate rows; `metafields[0]` lookup can read a stale status | **FIXED — Phase 4b** | `metafieldsSet` GraphQL mutation atomic upsert via `src/lib/shopify/mutations/orders.ts#setOrderMetafields` |
| 5 | **BLOCKER** | Non-atomic metafield write order — status='complete' could commit before `print_files` / `print_pipeline_results` lands, making the idempotency gate lie | **FIXED — Phase 4b** | All four pipeline metafields now written in one `metafieldsSet` call — atomic or nothing |
| 6 | **BLOCKER** | `processLineItem` could produce `kind: 'ok'` with empty `urls[]` if `processPrintJob` or `uploadPrintTiles` returned zero tiles → order marked 'complete' with no files, idempotency gate freezes | **FIXED — Phase 4b** | `webhook-failure-modes.test.ts` §"processPrintJob returns 0 tiles → no_tiles_generated" |
| 7 | **BLOCKER** | `layoutRotated` captured in builder but dropped by serializer → rotated Mosaicos 3/6 ships unrotated | **FIXED — Phase 4c** | `serializer.test.ts` §"mosaicos — layoutRotated round-trip" (4 tests) + `processor-contract.test.ts` §"mosaicos layoutRotated" (3 tests, incl. buffer-inequality proof for 3/6 and identity proof for 9) |
| 8 | MAJOR | Tonos `fitMode` serialized via `as unknown as` cast, webhook reads only `rotation`, `TonosPrintJob` has no fit-mode field → processor always crops-to-fill | **FIXED — Phase 2 (post-Phase-4c)** | `serializer.test.ts` §"Tonos — fitMode end-to-end (FIXED, was MAJOR)" (2 tests) + `processor-contract.test.ts` §"tonos — fitMode honored" (pixel-sample test on striped fixture) + `webhook-failure-modes.test.ts` Tonos passthrough + malformed-tonosSlots tests |
| 9 | MAJOR | Composite-reuse metadata stored in cart but not sent to Shopify → webhook regenerates from original photo, abandoned composites accumulate in R2 | **FIXED — Phase 3 (Appendix I)** | `webhook-failure-modes.test.ts` §"Phase 3.1 — composite-reuse bypass" (6 tests: happy path, version mismatch, untrusted key, dimension mismatch, Tonos bypass, key/url binding) |
| 10 | MAJOR | Font fidelity gap (STD/Arte/Studio/Spotify) — SVG text uses system fonts, preview diverges from print | **FIXED — Phase 4 + Phase 4 STD (Appendix I)** | font-loader.ts + canvas-text helper for Spotify/Studio/Arte; STD canvas overlay renderer for all 6 treatments (none/shadow/outline/halo/card/frame). 7 STD tests in `processor-contract.test.ts §"finding closures"` (white-pixel sample + treatment round-trip × 6) |
| 11 | MAJOR | Admin print-file download still enumerates raw R2 prefixes — partial-upload survivors can appear downloadable even while the line is failed. (Codex flag — not in scope of this audit, needs admin-UI fix.) | **FIXED — Phase 5 (Appendix I)** | `admin-print-files.test.ts` (13 tests covering parseR2KeyFromPublicUrl strict modes + cross-order tamper guard + regex-meta defense) + route rewrite gates downloads on `print_pipeline_status === 'complete'` + per-line metafield-driven listing |
| 12 | MINOR | `grid_type` / `preview_image_url` line-item attrs attached without `_` prefix → webhook filter drops them; email reader silently receives `undefined` | **FIXED — Phase 3 (Appendix I)** | `webhook-parser.test.ts` §"Phase 3.4: _preview_image_url and _grid_type survive the filter" + admin readers updated (`OrderCard.tsx`, `OrderDetailContent.tsx`) |
| 13 | MINOR | Studio Japanese text uses generic `sans-serif` SVG font-family → no guaranteed CJK fallback on Vercel Functions runtime | **FIXED — Phase 4 (Appendix I)** | `processor-contract.test.ts` §"finding closures" Studio CJK pixel-region test (proves `Noto Sans JP` glyphs render, not tofu) |

Legend:
- **FIXED**: code change on this branch makes the pinned test pass.
- **DEFERRED**: test is `test.todo(...)` with evidence pointer; fix lives on a follow-up branch.
- **NEW-BLOCKER**: identified during this audit, not in the original paired audit — discovered by the test suite.

---

## What FIXED covers

### BLOCKER #1 — webhook photo-fetch silent drop (Phase 3)

**Before:**
- `processLineItem` returned `string[]`. Empty could mean "no tiles needed" OR "photo-fetch failed silently".
- Admin email fired regardless; `printFileDownloadUrl` pointed at `/admin/pedidos/<n>` even when `allPrintUrls.length === 0`.
- Idempotency gate checked only that the `print_files` metafield was non-empty — a zero-tile run wrote no metafield, so on the next Shopify retry the gate was also empty and the same silent drop repeated.

**After:**
- `processLineItem(orderId, lineItem, deps)` returns a typed `LineItemResult` with 7 distinct `reason` codes: `missing_customization_attr` · `customization_parse_error` · `missing_photo_attrs` · `photo_attr_parse_error` · `tonos_slot_count_mismatch` · `photo_fetch_failed` · `crop_parse_error` · `print_pipeline_error` · `tile_upload_error`.
- `processWebhookOrder(order, deps, options)` orchestrates every line, isolates errors per-line, computes an overall `OrderPipelineStatus: 'complete' | 'partial' | 'failed' | 'empty'`.
- Three Shopify metafields written: `print_files` (successful URLs), `print_pipeline_status` (overall state), `print_pipeline_errors` (per-line failure summary).
- Admin email: when status is `partial` or `failed`, subject gets a `🚨 FALLO` or `⚠ PARCIAL` prefix, body shows a red banner + failed-items `<ul>`, download link is suppressed.
- Idempotency gate now checks `print_pipeline_status === 'complete'` — retries of partial/failed orders actually retry.

### BLOCKER #2 — R2 partial-upload + per-line idempotency (Phase 4)

**Before:**
- `uploadPrintTiles` used `Promise.all`. First rejection aborted; tiles already resolved kept their writes committed to R2 but no URL reached the metafield. Orphans accumulate.
- The caller caught a plain `Error` — no structured shape announcing which tile index failed or which succeeded. Retry had to re-upload everything (or nothing, if the idempotency gate fired).

**After:**
- `uploadPrintTiles` uses `Promise.allSettled` and throws a new `UploadFailure extends Error` carrying `succeeded: { index, key, publicUrl }[]` and `failed: { index, reason }[]`. Callers can now clean up orphans and/or surface structured retry information.
- A successful run returns the same `{ key, publicUrl }[]` shape as before — the happy-path contract is unchanged.
- `processWebhookOrder` accepts `{ priors: PriorLineResult[] }`. Lines whose prior run produced `kind: 'ok'` URLs are **skipped entirely** — their URLs flow into `allUrls` without any photo fetch, Sharp work, or R2 write. Prior failures are always retried.
- A new metafield `print_pipeline_results` (authoritative `PriorLineResult[]`) is written on every run and read as priors on every subsequent run.
- New `POST /api/admin/orders/[orderId]/retry` endpoint (admin-session-guarded) fetches the order via Shopify REST, reads priors, re-runs the orchestrator, writes metafields, and returns `{ status, tilesProduced, failures, reusedFromPriors }`. No admin UI in this PR; curl-callable.

### MAJOR #8 — Tonos `fitMode` end-to-end (Phase 2, post-Phase-4c)

**Before:**
- Per-slot `fitMode: 'fill' | 'fit' | 'stretch'` was captured in the cropper UI and persisted in the cart, but DIED at three boundaries:
  1. Serializer used `as unknown as CategoryCustomization` to bypass `TonosCustomization` not declaring `tonosSlots` — TypeScript lost the field.
  2. Webhook only whitelisted `rotation`, never read `fitMode`.
  3. `TonosPrintJob` had no `fitModes?` field; `processTonos` always called `cropAndResize` with no fit-mode arg → Sharp `fit: 'fill'` (non-uniform stretch) for every slot.
- Result: real users picking `'fit'` got the stretched output of `'fill'` — preview ↔ print mismatch on a purchasable feature.
- Codex re-audit caught a second layer: `ImageCropperMulti.tsx` Cropper used `aspect={1}` for both `'fill'` and `'fit'` — even after the pipeline-side fix, the user-emitted cropArea was square, and Sharp `'contain'` on a 1:1 cropArea is identity. `'fit'` would silently degrade to `'fill'` again.

**After:**
- Centralized types in `customization-types.ts`: `TonosFitMode`, `TonosRotation`, `TonosSlotConfig`, `TonosSlotConfigs`. All consumers (cart-store, useBuilderFlow, MagnetBuilder, serializer, types.ts) re-export from there.
- Serializer cast removed; `TonosCustomization` now declares `tonosSlots?: TonosSlotConfigs` directly.
- New `whitelistTonosFitModes(slotsRaw)` mirrors `whitelistTonosRotations` shape; per-slot invalid → `'fill'`, wrong-shape → `undefined`.
- Webhook + `/api/cart-composite` + `/api/generate-print` all read `slotsRaw` once and forward both `rotations` + `fitModes` into `TonosPrintJob`.
- `cropAndResize` extended with `{ fitMode, background }` options bag mapping UI mode → Sharp fit (`fill→cover`, `fit→contain`, `stretch→fill`); cream `#efebe0` letterbox.
- `processTonos` per-slot: `cropAndResize(buf, area, 827, 827, { fitMode: fitModes?.[i] ?? 'fill', background: TONOS_LETTERBOX_BG })`.
- `ImageCropperMulti.tsx`: `cropperAspect = fitMode === 'fit' ? rotatedSourceAspect : 1`. For `'fit'`, the cropper waits for `imageSize` to load before mounting (avoids emitting a stale 1:1 cropArea). `StretchPreview` now swaps `width`/`height` for 90/270 rotation so the synthetic full-image cropArea matches the rotated source bounds.
- `MagnetPreview.tsx` uses a new `getCroppedTileWithFit` helper in `canvas-utils.ts` that mirrors Sharp's cover/contain/fill semantics in a JS canvas — preview ↔ print parity holds.
- Cropper container: `bg-charcoal → bg-cream` so `'fit'` mode preview shows the same letterbox color the printer will emit.

**Tests:** `serializer.test.ts` "Tonos — fitMode end-to-end" (2 tests, casts removed) + `processor-contract.test.ts` "tonos — fitMode honored" (pixel-sample on cyan/red/yellow striped 800×2000, samples top + bottom corners to discriminate `'cover'` from `'fill'`) + `webhook-failure-modes.test.ts` "tonos fitMode whitelisted" + "malformed tonosSlots fallback" (2 tests).

### MAJOR #9 + MINOR #12 — Cart correctness (Phase 3, Appendix I)

Phase 3 closed two findings + three follow-ups in one PR on the cart→webhook surface:

**MAJOR #9 — Composite-reuse metadata not forwarded.**
- Cart-composite endpoint produces a canonical PNG and stores it under `cart-composites/<jobId>.png`. Pre-Phase-3, the cart held the key but checkout dropped it; webhook always re-rendered. R2 orphans accumulated; Sharp work doubled.
- New: cart line attrs `_composite_key` + `_composite_url` + `_composite_pipeline_version`. Webhook reads them with strict gates: regex prefix (`^cart-composites/[\w-]{1,128}\.png$`), pipeline-version match (per `src/lib/print-pipeline/version.ts#PIPELINE_VERSION`), URL derived from key (ignores client-supplied `_composite_url` to prevent steered fetches), composite dimension match against `getCompositeLayout(customization)`. On any failure → fall through to full pipeline.
- Bypass uses new `splitCompositeIntoTiles` helper in `assemble-tiles.ts` — extracts pixel regions per `TilePlacement` placement. Category-agnostic: same path for Mosaicos, Tonos (tones+logo already baked into composite), STD/Arte/Studio (text already rendered), Spotify, Polaroid.
- After successful tile upload + metafield write, fire-and-forget `deleteFile('print-files', compositeKey)` cleans up the cart-composite. R2 lifecycle policy reaps any abandoned composites.
- Pipeline version stamped at composite-creation time (cart-composite endpoint returns `pipelineVersion`), persisted on the cart item, forwarded at checkout. Phase 4 (font fidelity) bumps the const → stale composites fall through to full render.

**MINOR #12 — Attr naming reconciliation.**
- `preview_image_url` and `grid_type` were stamped without the `_` prefix → webhook's `extractCustomizedLineItems` filter dropped them → admin UI + email reader silently saw `undefined`.
- Renamed at producer (`checkout.ts`) + every reader: webhook route email path, admin `OrderCard.tsx`, admin `OrderDetailContent.tsx`. Filter retains them via the existing `_`-prefix rule.

**Follow-ups landed in the same commit:**
- **Production data-URL fallback gate** (`MagnetBuilder.tsx#uploadOrEncode`): throws in production instead of returning `{ kind: 'data', data: ... }`. The throw surfaces as the photo-uploader retry UI. Pre-fix: a transient R2 upload failure could produce a purchasable order with empty `_photo_url` → webhook had no photo to render.
- **Empty-cart resurrect fix** (`/api/cart/save` + `cart-store.ts` + `pagehide`): on transition to empty, `/api/cart/save` deletes the `mosaiko_cart_id` cookie. cart-store performSync uses an AbortController so older non-empty saves can't race ahead of the empty save and re-create the cookie. `lastSyncedItems` set only on successful response (failed saves no longer suppress retries). Pagehide flushes empty via beacon when items differ from last-synced AND we've ever synced this session.
- **Predesigned-line BLOCKER** (caught by Codex audit): `_preview_image_url` + `_grid_type` are stamped only when `item.customizations` exists, so a predesigned line carries zero `_`-prefixed attrs and the webhook filter correctly drops it (no `missing_customization_attr` failure on catalog-only orders).

**Tests:** `webhook-failure-modes.test.ts` adds 6 composite-reuse tests (happy path, version mismatch, untrusted key, dimension mismatch, Tonos bypass, key/url binding). `webhook-parser.test.ts` adds 2 (predesigned-drops, attr-prefix retention). Total integrity tests now **84 passing + 1 todo** (was 76+3 after Phase 2; +5 net new + 2 stale TODOs converted).

### BLOCKERS #3–6 — Codex second-pass findings (Phase 4b)

During the post-fix audit Codex flagged four additional must-fix issues within the same surface area:

1. **Tonos `intensity='strong'` crashes the print pipeline.** `filter-presets.ts#scaleTone` multiplies base hue `15°` by `1.5` → `22.5°`. Sharp's `modulate({ hue })` rejects non-integer values. Any real purchase of a Tonos magnet with intensity 'strong' (the UI exposes it) would throw at order time. Fixed by `Math.round(config.hueRotation)` at the pipeline boundary in `processors/tonos.ts#applySharpFilter`. New test: `processor-contract.test.ts` §"tonos intensity=\"strong\" no longer crashes".
2. **Metafield REST POST is create-not-upsert.** The original `POST /admin/api/.../orders/{id}/metafields.json` always creates a new row — it does not update an existing `(namespace, key)`. After N webhook retries, N rows existed with the same key, and the idempotency read's `metafields[0]` picked an arbitrary stale status. Fixed by switching all pipeline metafield writes to the GraphQL `metafieldsSet` mutation via a new helper `src/lib/shopify/mutations/orders.ts#setOrderMetafields`. Batched: all four metafields (`print_pipeline_status`, `print_pipeline_results`, `print_files`, `print_pipeline_errors`) are written in one atomic mutation — Shopify commits all or none.
3. **Non-atomic metafield write order.** The old code wrote `print_pipeline_status` first, then the other metafields. If one of the later writes failed, the order was marked `complete` while the supporting data was stale — the idempotency gate then locked out correct retries. Fixed by the single-mutation batch in #4; status field is placed last in the mutation array as an explicit intent marker.
4. **`kind: 'ok'` with empty URLs.** If `processPrintJob` or `uploadPrintTiles` produced zero tiles, `processLineItem` returned `kind: 'ok', urls: []`. The order was marked `complete`, no `print_files` was written, and the idempotency gate froze future retries. Fixed by adding a `no_tiles_generated` reason code + explicit tile-count invariants in both the Tonos and single-image processing paths. New test: `webhook-failure-modes.test.ts` §"processPrintJob returns 0 tiles → no_tiles_generated".

---

## Test coverage map

| File | Tests | Finding pinned |
|---|---|---|
| `src/__tests__/integrity/serializer.test.ts` | 26 passing + 0 todo | `buildPrintCustomization` round-trip per category × grid; JSON cart-attribute survival; Tonos rotation + fitMode in cart (now typed, no cast); BLOCKER #7 layoutRotated round-trip (4 tests); finding #8 Tonos fitMode end-to-end (2 tests) |
| `src/__tests__/integrity/webhook-parser.test.ts` | 21 passing | `extractCustomizedLineItems` `_`-prefix filter; `whitelistTonosRotations` quarter-turn clamp; `safeJsonParse` malformed-input safety; captured-fixture payload integration; **finding #12 + Phase-3 BLOCKER fix:** `_preview_image_url` + `_grid_type` retention; predesigned line drops (no `_` attrs → filter drops it) |
| `src/__tests__/integrity/webhook-failure-modes.test.ts` | 21 passing + 0 todo | BLOCKERs #1 + #6 (8 tests); BLOCKER #2 `UploadFailure` shape + per-line idempotency reuse/retry (5 tests); finding #8 Tonos fitMode passthrough + malformed-tonosSlots fallback (2 tests); **finding #9 Phase-3.1 composite-reuse bypass — 6 tests:** happy path, version-mismatch fall-through, untrusted-key rejection, dimension mismatch, Tonos bypass (composite for non-Mosaicos), key/url binding (server derives URL from validated key) |
| `src/__tests__/integrity/processor-contract.test.ts` | 16 passing + 1 todo | Every processor produces N 827×827 PNG tiles; Tonos `intensity='strong'` regression test; BLOCKER #7 mosaicos layoutRotated — buffer-inequality for 3/6 and byte-identity for 9 (3 tests); finding #8 Tonos fitMode pixel-sample on striped fixture (1 test); finding #13 Studio CJK captured as todo (Phase 4 of Appendix I plan) |

Totals: **84 passing, 1 todo (85 tests total), 4 test files, `tsc --noEmit` clean.** (Phase 3 added 8 passing tests + converted 2 stale TODOs after closing findings #9 + #12.)

Run: `npm test`.

---

## Manual-QA checklist (mocks can't cover)

Items that require a live Shopify store + R2 bucket + Vercel runtime. None are automated; run before shipping the retry endpoint or when touching the webhook surface.

- [ ] End-to-end purchase: buy a custom Mosaico 9 with a real photo, confirm admin email banner state reflects actual outcome.
- [ ] Shopify webhook retry: make the first attempt fail R2 (block the bucket briefly), confirm second attempt succeeds and doesn't duplicate tiles.
- [ ] `POST /api/admin/orders/[orderId]/retry` on a partial order: confirm prior-reuse count, new tile count, metafield update visible in Shopify admin.
- [ ] Tonos 3+9 orders with rotations {0, 90, 180, 270} — verify printed tiles match the preview rotation.
- [ ] CJK font check: order a Studio magnet with `千と千尋の神隠し`, verify the printed PNG tile does NOT render tofu squares. (Covers finding #9 either way — captures which way it goes.)
- [ ] Font fidelity check: order an Arte magnet with a Playfair-Display title, verify PNG tile renders in Playfair not a DejaVu fallback. (Covers finding #7.)
- [ ] Layout-rotated Mosaico 6: upload a landscape photo, rotate the cropper orientation, add to cart, confirm printed tiles preserve the rotation. (Covers finding #4.)
- [ ] Tonos strong intensity: place a Tonos order with `intensity='strong'` — current expectation: webhook-side crash, admin email shows `🚨 FALLO`. Fix lands via separate branch. (Covers finding #3.)

---

## Related docs

- `DEFERRED.md` — concrete remaining items with file:line + fix direction.
- `/Users/ekasis/.claude/projects/-Users-ekasis-Documents-Projects-Mosaiko/memory/server_font_fidelity_gap.md` — font fidelity (finding #7).

---

## Branch history

- `4ec941d` test(integrity): vitest harness + confirmation test suite (Phase 1+2)
- `1547c49` test(integrity): apply Codex Phase-2 review — labels, CJK minor, orphan proof
- `c9b842d` fix(webhook): surface per-line-item failures (BLOCKER #1)
- `a105861` fix(webhook,storage): structured R2 failures + per-line retry (BLOCKER #2)
- `482769c` fix(webhook,tonos): Codex Phase-4 findings — atomic metafieldsSet, tile-count invariant, tonos hue rounding (BLOCKERs #3–6)
- `041e375` fix(webhook): Codex final-pass patches — always-overwrite empty metafield keys, retry endpoint surfaces 500 on metafield-write failure
- `ade90a0` fix(mosaicos): thread layoutRotated end-to-end (BLOCKER #7)
- `936be78` fix(mosaicos): Codex audit — preview/cart/print parity (assemble-tiles + cart-composite request + composite-dimension oracle tests)
- `0788dd7` fix(tonos): Tonos `fitMode` end-to-end (MAJOR #8) — types centralized, serializer cast removed, webhook + endpoints whitelist + forward, processor honors per-slot fitMode, cropper aspect respects fit mode, preview helper mirrors Sharp semantics
- (this commit) fix(cart): cart correctness — composite-reuse bypass + attr naming + data-URL gate + empty-cart resurrect (MAJOR #9 + MINOR #12; Appendix I Phase 3) — closes the last two cart→webhook correctness defects from the integrity audit; 5-round Codex audit converged on cart-store sync race + key/url binding + version-stamp timing + predesigned-line BLOCKER
