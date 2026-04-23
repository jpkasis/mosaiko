# Deferred work — pipeline integrity

Items identified during the pipeline integrity audit (`INTEGRITY_AUDIT.md`)
that were intentionally scoped out of the two-BLOCKER fix. Each entry has
enough context to pick up cold.

**Branch:** `fix/pipeline-integrity` (off `fix/cart-display-and-print-shape`).
**Last updated:** 2026-04-23.

---

## BLOCKERs deferred (reclassified per Codex second-pass)

### `layoutRotated` never reaches the serializer → rotated Mosaicos ship unrotated
- **Where:** `src/components/builder/MagnetBuilder.tsx:~228` sets `customizations.layoutRotated`; `src/lib/shopify/customization-serializer.ts:67` (mosaicos branch of `buildPrintCustomization`) doesn't reference it.
- **Symptom:** A user who toggles layout rotation on Mosaicos 3/6 sees a rotated preview in the builder, but the serialized `_customization` JSON has no rotation flag. The webhook's `processMosaicos` uses the unrotated grid — printed tiles come out with the wrong orientation.
- **Severity:** BLOCKER-if-purchasable. Feature IS exposed today.
- **Fix direction:**
  1. Add `layoutRotated?: boolean` to the mosaicos branch of `CategoryCustomization` (src/lib/customization-types.ts).
  2. Thread it through `buildPrintCustomization` (serializer).
  3. In `processMosaicos`, when `layoutRotated === true` for gridSize 3 or 6, swap rows/cols on the crop-output size.
- **Test:** `serializer.test.ts` §"known integrity gaps" todo #1 — unstub when the serializer learns about `layoutRotated`.

---

## MAJORs deferred

### Tonos `fitMode` serialized via cast but print pipeline ignores it
- **Where:** `src/lib/shopify/customization-serializer.ts:130` (cast), `src/app/api/webhooks/shopify/route.ts` (reads only `rotation`), `src/lib/print-pipeline/types.ts:28` (`TonosPrintJob` has no `fitMode` field), `src/lib/print-pipeline/processors/tonos.ts` (`cropAndResize` with fixed crop-to-fill).
- **Symptom:** User picks `fitMode: 'fit'` or `'stretch'` per Tonos slot in the builder; the setting is serialized into the cart JSON (surviving the cart round-trip) but the webhook never reads it and the processor always crops-to-fill.
- **Fix direction:**
  1. Add `fitMode?: ['fill' | 'fit' | 'stretch', ...3]` to `TonosPrintJob`.
  2. In the webhook route, read `tonosSlots[].fitMode` alongside `rotation` (same whitelist pattern) and forward into the print job.
  3. In `processTonos`, per slot: if `fitMode === 'fit'` letterbox with background; if `'stretch'` skip aspect preservation; if `'fill'` behave as today.
- **Test:** `serializer.test.ts` §"known integrity gaps" todo #2; add pixel-sampling assertion in `processor-contract.test.ts` once processor supports it.

### Composite-reuse metadata stored in cart but not sent to Shopify
- **Where:** `src/components/builder/MagnetBuilder.tsx:~228` sets `customizations.compositeKey` + `compositeUrl`; `src/lib/shopify/checkout.ts#buildCartLines` does not serialize these as line-item attributes.
- **Symptom:** The cart's `/api/cart-composite` already produced a canonical composite PNG and stored it in R2. The webhook does not know this and regenerates by splitting the original photo. Result: the composite R2 object is abandoned, and the webhook does 2× the Sharp work.
- **Fix direction:** Forward `compositeKey` as a `_composite_key` line-item attribute; in the webhook, when present, bypass `processPrintJob` and split the stored composite via `assembleTilesToComposite`'s inverse or direct Sharp extract.
- **Test:** `processor-contract.test.ts` §known-gaps todo #3.

### Server-side font fidelity gap
- **Where:** `src/lib/print-pipeline/processors/{save-the-date,arte,studio,spotify}.ts` — SVG text uses system fonts via librsvg's fontconfig, which on Vercel Functions has no Google-Fonts equivalents.
- **Symptom:** Preview renders text in Playfair / Cormorant / Great-Vibes / Montserrat; print PNG falls back to DejaVu Sans or similar. Preview ↔ print divergence violates the "what you see is what you print" promise.
- **Scope:** STD + Arte + Studio + Spotify.
- **Fix direction (pick one):**
  - Bundle TTF files in `public/fonts/` and embed `@font-face` data URIs inside SVG strings.
  - Migrate `src/lib/print-pipeline/utils/text-renderer.ts` to `@napi-rs/canvas` with `registerFont`.
- **Reference:** `memory/server_font_fidelity_gap.md`.

### Admin print-file download enumerates raw R2 prefixes
- **Where:** `src/app/api/admin/print-files/` (prefix-listing endpoint) and `src/app/admin/pedidos/[orderNumber]/page.tsx` (consumer).
- **Symptom:** Partial-upload survivors (from any PR prior to this audit) can still appear as downloadable tiles even when the overall order is `partial` or `failed`. Admin may ship an incomplete multi-line order thinking it's complete.
- **Fix direction:** Gate downloads on `print_pipeline_status === 'complete'` AND compute the tile list from the authoritative `print_pipeline_results` metafield, not an R2 prefix listing.
- **Test:** Not yet captured; open a new test file once the admin route is scoped.

---

## MINORs deferred

### `grid_type` / `preview_image_url` attached without `_` prefix
- **Where:** `src/lib/shopify/checkout.ts` (producer), `src/lib/email/resend-client.ts:433` (consumer).
- **Symptom:** The webhook `_`-filter in `extractCustomizedLineItems` drops unprefixed keys, but the email reader grabs them from the same `attrs` map. The code happens to work because the email template reads from `customizedItems[].attrs` (the filter-kept subset), but the naming is inconsistent with every other attribute.
- **Fix direction:** Prefix both with `_` at the source, update the reader. Alternatively: teach `extractCustomizedLineItems` to preserve a small whitelist of display-only attrs.

### Studio Japanese text uses generic `sans-serif` SVG font-family
- **Where:** `src/lib/print-pipeline/processors/studio.ts:195` — the `japaneseText` SVG layer uses `font-family="sans-serif"` and relies on the Vercel runtime having a CJK font in fontconfig's chain.
- **Symptom:** Japanese characters (e.g. `千と千尋の神隠し`) may render as tofu squares on Vercel Functions. Subset of the broader font fidelity gap.
- **Fix direction:** Bundle Noto Sans JP (or similar CJK font) and pin `font-family` explicitly for the `japaneseText` layer.

---

## Codex second-pass observations (context only — not action items)

- **R2 overwrite on retry is logically safe** if inputs are immutable and the Sharp render is deterministic. Cost is just extra PUT/Sharp work — acceptable for a manual-retry path.
- **REST Admin API is legacy.** The hardcoded `2024-01` in `shopifyAdminFetch` should be bumped at some point, but not on this branch.
- **Retry endpoint is not idempotent against a concurrent webhook.** If Shopify fires a duplicate webhook AND an admin clicks retry at the same time, both will call `metafieldsSet` — the atomic mutation means no corruption, but the last write wins. In practice the two paths converge on the same result because they operate on the same prior state.

---

## One-off cleanup tasks (manual, low-effort)

### Clean up stale historical metafields from pre-PR REST create loop
- **Where:** Shopify admin (UI or REST API).
- **Symptom:** Orders processed before this branch wrote metafields via `POST /admin/api/.../metafields.json`, which always CREATES. Those orders may have 2+ rows with the same `(mosaiko, print_files)` or `(mosaiko, print_pipeline_status)` tuple. Any future code that reads `metafields[0]` can pick an arbitrary historical row.
- **Fix:** One-time script or manual pass: for each order with pipeline-related metafields, keep only the most-recent row per `(namespace, key)` pair. Only needed if any consumer still reads metafields by prefix listing instead of by exact (namespace, key) lookup.
- **Urgency:** Low — every subsequent webhook retry upserts via `metafieldsSet` (by `(ownerId, namespace, key)`), so new runs overwrite correctly. Existing duplicates accumulate only until first upsert.

### Orphaned R2 tile objects from pre-fix partial uploads
- **Where:** R2 `mosaiko-print-files` bucket.
- **Symptom:** Before BLOCKER #2 was fixed, a partial `Promise.all` failure left tiles with deterministic keys `print-files/order-{N}-item-{M}/tile-{k}.png` in R2 with no reference from any metafield. Storage is cheap; admin cannot see them; deterministic-key retries overwrite them eventually.
- **Fix:** Either leave them (they'll get overwritten on next retry, and untouched objects are free-ish to keep) or run a one-shot list-and-prune script comparing R2 keys against metafield URLs per order.
- **Urgency:** Very low. `UploadFailure.succeeded` is now surfaced at the storage layer so a future admin cleanup endpoint could use it; not in scope for this branch.

---

## Related docs

- `INTEGRITY_AUDIT.md` — full audit report, findings table, test coverage map.
- `/Users/ekasis/.claude/projects/-Users-ekasis-Documents-Projects-Mosaiko/memory/server_font_fidelity_gap.md` — font fidelity deep dive.
