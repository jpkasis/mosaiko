# Deferred work

Consolidated from two independent tracks that co-exist on `qa/integration`:

- **Foundation refactor + mobile polish** (`polish/m6-home-catalog` and its refactor stack) — below.
- **Pipeline integrity audit** (`fix/pipeline-integrity`) — further below under "Deferred work — pipeline integrity".

Last updated: 2026-04-23 (QA integration rebuild — both tracks merged locally; each source branch keeps its own version for independent review).

---

## From the foundation refactor + mobile polish pass

Items identified during the foundation refactor and mobile polish pass
that were intentionally scoped out. Each entry has enough context to
pick up cold.

---

## Pre-existing risks (base branch: `fix/cart-display-and-print-shape`)

These are on the cart branch **before** any of the refactor / polish
landed. Codex flagged them in both its foundation-refactor audit and
its mobile-polish audits.

(Two prior items here — empty-cart resurrect + data-URL fallback —
were resolved in **Phase 3 of Appendix I** on `fix/cart-correctness`.
Cookie clear + AbortController + pagehide flush + production-throw
gate covered both.)

### Shipping ETA inconsistency across surfaces
- **Where:** Cart drawer + cart page say `Estándar · 3–5 días hábiles` (from polish M5/M6); order-confirmation email (`src/lib/email/resend-client.ts:105`) says `5 a 10 días hábiles`.
- **Fix direction:** Product decision — pick the true window, then standardize all surfaces (cart copy, email, order confirmation page, FAQ "shipping" section if it exists).

---

## Server-side print fidelity

### Google-font fidelity gap in print PNGs
- **Where:** `src/lib/print-pipeline/processors/{arte,studio,save-the-date}.ts` — SVG strings use `font-family="Montserrat, sans-serif"` / `"Playfair Display, serif"` / etc.
- **Symptom:** Sharp renders SVG via librsvg, which reads fonts from the OS via fontconfig. Vercel's Node runtime has no Google Fonts installed, so the printed magnet uses DejaVu / Liberation Sans instead of the brand font the user picked. Preview ↔ printed-output diverges — violates the "what you see is what you print" promise.
- **Scope:** Affects STD + Arte + Studio print outputs. Does NOT affect mobile UX.
- **Fix direction (pick one):**
  - Bundle the TTF files in `public/fonts/` and embed `@font-face` data URIs inside the SVG strings, OR
  - Migrate `src/lib/print-pipeline/utils/text-renderer.ts` to `@napi-rs/canvas` with `registerFont`.
- **Reference:** `memory/server_font_fidelity_gap.md`.

---

## Polish follow-ups

### `visualViewport` keyboard inset for the sticky CTA
- **Where:** `src/components/builder/MagnetBuilder.tsx` — the `stickyCta` footer.
- **Deferred from:** PR M4 (text-customization + keyboard coexistence).
- **Symptom today:** When the iOS soft keyboard opens over text inputs in the customize step, the sticky CTA at the bottom of the viewport is covered by the keyboard. The user can still blur the input and hit the CTA — tolerable, not optimal.
- **Fix direction:** Add a `visualViewport.addEventListener('resize', …)` listener in `MagnetBuilder`; compute `keyboardInset = window.innerHeight - window.visualViewport.height`; apply `bottom: keyboardInset` to the sticky-CTA footer so it rides above the keyboard.
- **Why deferred:** DevTools can't simulate the iOS soft keyboard; needs real-device testing to verify across iOS Safari / Chrome / Android Chrome.

### Tonos (multi-image cropper) ergonomics toolbar
- **Where:** `src/components/builder/ImageCropperMulti.tsx`.
- **Deferred from:** PR M3 (cropper ergonomics).
- **What:** The `Restablecer` / `Cambiar foto` toolbar from M3 only applies to the single-image `ImageCropper`. Tonos still lacks a per-slot reset / replace affordance; users re-pick each slot from the upload step instead.
- **Fix direction:** Lift per-slot reset into `ImageCropperMulti`; for "replace" there's already per-slot re-pick in `PhotoUploaderMulti` via direct file-input tap on each slot, so this is a nice-to-have rather than a blocker.

### Upload-step sticky CTA
- **Where:** `src/components/builder/MagnetBuilder.tsx`.
- **Deferred from:** PR M1 (sticky CTA).
- **What:** M1 only put a sticky CTA on `customize` + `preview` steps, where the advance callback is in `useBuilderFlow`. The `upload` step's proceed logic is internal to `PhotoUploader`; wiring a sticky CTA there requires either lifting `selectedFile` into the hook or exposing an imperative handle.
- **Fix direction:** Lift `selectedFile` + `phase` state into `useBuilderFlow` so the sticky CTA can own `upload` advance. Low risk but invasive.

---

## Out of scope for this phase

The plan (`/Users/ekasis/.claude/plans/expressive-scribbling-dawn.md`)
explicitly deferred these; listing here for consolidated tracking.

### Admin panel mobile UX
- **Why deferred:** `CLAUDE.md` explicitly states admin is desktop-primary. Mobile polish of the admin dashboard wasn't part of the conversion-funnel scope.
- **Status:** No action planned unless the client requests it.

### Content pages polish (About / FAQ / Contact / legal)
- **Why deferred:** Conversion funnel first (home → builder → cart → catalog). Content pages don't drive purchase directly.
- **Status:** Future "content pages pass" if the client wants consistency across the site. Low priority vs. funnel.

### Visual redesign of existing components
- **Scope cap:** "Polish + selective restructure" per user decision. The rulebook (Appendix B of the plan file) codified the spacing/typography/motion/touch rules; we did not redesign the aesthetic.

---

## Release pipeline

### Nothing has been pushed to `origin`
- **Current state:** 16+ local branches (6 refactor + 6 polish + `qa/integration` + `fix/carousel-ver-detalles-link` + `fix/cart-display-and-print-shape`). None are on GitHub yet.
- **Next step:** Push the refactor stack, the carousel fix, and the polish stack, then open PRs in order:
  1. Cart-branch fixes (if we tackle the pre-existing risks first)
  2. `refactor/pr0-platform-tokens` → `refactor/pr1a…pr3-builder-mobile` (6 PRs)
  3. `fix/carousel-ver-detalles-link` (parallel; can land any time)
  4. `polish/m1…m6` (6 PRs, stacked on the refactor)
- **Client sign-off:** Probably wants to see the foundation refactor before the polish lands on top. Split into two review waves: foundation first, polish second.

### Shopify store not created
- **From:** `memory/phase1_progress.md`.
- **Blocker:** Client needs to create the Shopify store with product "Imanes Personalizados" (4 variants: 3/4/6/9 piezas) and set env vars (`SHOPIFY_VARIANT_MAP`, `RESEND_API_KEY`, `ADMIN_PASSWORD_HASH`, `ADMIN_JWT_SECRET`).
- **Status:** Not a development task; waiting on client.

---

## Long-tail (pre-existing roadmap, not from this session)

Captured in `memory/phase1_progress.md` for reference — listed here so
the next agent sees the full picture:

- Customer order-tracking public page (`/pedido/[orderNumber]`).
- Shopify metaobjects as CMS + admin "Contenido" section.
- GA4 analytics dashboard + event helpers.
- Admin settings page (shipping / notifications config).
- Hero mosaic tile alignment bug (`memory/hero_tile_bug.md`).

None of these interact with the mobile polish surface; they're
sequenced independently by the client.

---

## From the pipeline integrity audit

Items identified during the pipeline integrity audit (`INTEGRITY_AUDIT.md`)
that were intentionally scoped out of the two-BLOCKER fix. Each entry has
enough context to pick up cold.

**Branch:** `fix/pipeline-integrity` (off `fix/cart-display-and-print-shape`); Phase 2 Tonos fitMode landed on `fix/tonos-fitmode` (off `qa/integration`); Phase 3 cart correctness landed on `fix/cart-correctness` (off `fix/tonos-fitmode`).
**Last updated:** 2026-04-25 (post Phase 3 — cart correctness: composite-reuse, attr-naming, data-URL gate, empty-cart resurrect — all resolved).

---

## MAJORs deferred

(Server-side font fidelity gap was FULLY FIXED in Phase 4 + Phase 4
STD migration. Save-the-Date now uses a canvas-based overlay renderer
with per-treatment canvas equivalents (ctx.shadow* for shadow + card,
ctx.filter='blur()' for halo, strokeText for outline, strokeRect for
frame). See `INTEGRITY_AUDIT.md` row #10 + `processor-contract.test.ts`
finding-closures section for the 7-test STD regression fence.)

(Admin print-file R2 gate was FIXED in Phase 5 (Appendix I) — route
rewritten to read `print_pipeline_status` + `print_pipeline_results`
metafields, gates downloads on status==='complete', parses R2 keys via
`parseR2KeyFromPublicUrl` with cross-order tamper protection. See
`INTEGRITY_AUDIT.md` row #11 + `admin-print-files.test.ts` for the
13-test regression fence.)

---

## MINORs deferred

(Studio CJK font fallback was FIXED in Phase 4 — Noto Sans JP now bundled
and pinned explicitly. See `INTEGRITY_AUDIT.md` row #13 + the
`processor-contract.test.ts` "finding closures" Studio CJK pixel-region
test for the regression fence.)

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
