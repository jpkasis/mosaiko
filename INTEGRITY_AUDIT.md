# Pipeline Integrity Audit

**Scope:** builder → `/api/cart-composite` → cart store → Shopify cart-attribute JSON → Shopify hosted checkout → Shopify order webhook → `processPrintJob` → Sharp pipeline → `uploadPrintTiles` → R2 → admin email → tile ZIP.

**Goal:** confirm every piece of user-designed data (photo, crop, category, grid, text, effects, Tonos tones + fit mode + rotation, Arte info tile, Studio text panels, Spotify bar, Polaroid frame) faithfully survives the chain to the PNG tiles the admin downloads for printing.

**Methodology:**
- Paired codebase audit (Explore agent + Codex) on `fix/cart-display-and-print-shape` ancestry.
- Fixture-based vitest suite under `src/__tests__/integrity/` — every finding pinned as a named test.
- Dependency-injected orchestrator + mock + captured-fixture webhook payloads; no live Shopify, no live R2.

**Branch:** `fix/pipeline-integrity` (off `fix/cart-display-and-print-shape`).

**Last updated:** 2026-04-23.

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
| 7 | MAJOR → BLOCKER (per Codex) | `layoutRotated` captured in builder but dropped by serializer → rotated Mosaicos 3/6 ships unrotated. BLOCKER if rotated Mosaicos are purchasable (they are). | **DEFERRED** | `serializer.test.ts` §"known integrity gaps" todo #1 + `processor-contract.test.ts` §known-gaps todo #2 |
| 8 | MAJOR | Tonos `fitMode` serialized via `as unknown as` cast, webhook reads only `rotation`, `TonosPrintJob` has no fit-mode field → processor always crops-to-fill | **DEFERRED** | `serializer.test.ts` §"known integrity gaps" todo #2 + `processor-contract.test.ts` §known-gaps todo #1 |
| 9 | MAJOR | Composite-reuse metadata stored in cart but not sent to Shopify → webhook regenerates from original photo, abandoned composites accumulate in R2 | **DEFERRED** | `processor-contract.test.ts` §known-gaps todo #3 |
| 10 | MAJOR | Font fidelity gap (STD/Arte/Studio/Spotify) — SVG text uses system fonts, preview diverges from print | **DEFERRED** (tracked separately) | `memory/server_font_fidelity_gap.md` |
| 11 | MAJOR | Admin print-file download still enumerates raw R2 prefixes — partial-upload survivors can appear downloadable even while the line is failed. (Codex flag — not in scope of this audit, needs admin-UI fix.) | **DEFERRED** | See DEFERRED.md |
| 12 | MINOR | `grid_type` / `preview_image_url` line-item attrs attached without `_` prefix → webhook filter drops them; email reader silently receives `undefined` | **DEFERRED** | `processor-contract.test.ts` §known-gaps todo #4 |
| 13 | MINOR | Studio Japanese text uses generic `sans-serif` SVG font-family → no guaranteed CJK fallback on Vercel Functions runtime | **DEFERRED** | `processor-contract.test.ts` §known-gaps todo #5 |

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
| `src/__tests__/integrity/serializer.test.ts` | 20 passing + 2 todo | `buildPrintCustomization` round-trip per category × grid; JSON cart-attribute survival; Tonos rotation + fitMode in cart; findings #7 + #8 via todo |
| `src/__tests__/integrity/webhook-parser.test.ts` | 19 passing | `extractCustomizedLineItems` `_`-prefix filter; `whitelistTonosRotations` quarter-turn clamp; `safeJsonParse` malformed-input safety; captured-fixture payload integration |
| `src/__tests__/integrity/webhook-failure-modes.test.ts` | 13 passing + 0 todo | BLOCKERs #1 + #6 (8 tests on typed `LineItemResult` + `no_tiles_generated` invariant); BLOCKER #2 `UploadFailure` shape + per-line idempotency reuse/retry (5 tests) |
| `src/__tests__/integrity/processor-contract.test.ts` | 12 passing + 5 todo | Every processor produces N 827×827 PNG tiles with stable indexes; Tonos `intensity='strong'` regression test; findings #7 #8 #9 #10 #12 #13 captured as todos |

Totals: **64 passing, 7 todo (71 tests total), 4 test files, `tsc --noEmit` clean.**

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
- (pending) fix(webhook): Codex final-pass patches — always-overwrite empty metafield keys, retry endpoint surfaces 500 on metafield-write failure
