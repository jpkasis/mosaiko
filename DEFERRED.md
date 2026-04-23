# Deferred work

Items identified during the foundation refactor and mobile polish pass
that were intentionally scoped out. Each entry has enough context to
pick up cold.

Last updated: 2026-04-22

---

## Pre-existing risks (base branch: `fix/cart-display-and-print-shape`)

These are on the cart branch **before** any of the refactor / polish
landed. Codex flagged them in both its foundation-refactor audit and
its mobile-polish audits. Shouldn't block shipping the refactor, but
worth landing on a dedicated fix branch off the cart branch.

### Empty-cart can resurrect from the Shopify cookie
- **Where:** `src/lib/cart-store.ts:217` (sync skip) + `src/app/api/cart/save/route.ts:49` (returns 204 without clearing cookie) + `src/components/cart/CartHydrator.tsx:20` (restores whenever local items are empty).
- **Symptom:** Removing all items, clearing after checkout, or returning from checkout can resurrect the prior Shopify cart from `mosaiko_cart_id`.
- **Fix direction:** Delete the cookie / remote state on empty save, OR make `CartHydrator` distinguish "localStorage missing" from "persisted empty cart."

### Data-URL upload fallback can produce non-printable orders in production
- **Where:** `src/components/builder/MagnetBuilder.tsx` `uploadOrEncode()`.
- **Symptom:** On a transient R2 upload failure, the fallback path can add a cart item whose `photoStorageUrl(s)` are empty strings. Checkout serializes those, and the webhook regenerates from `_photo_url(s)` rather than the stored composite — a purchasable but non-printable order is possible.
- **Fix direction:** Either block the data-URL fallback in production (throw instead), OR teach the webhook to consume `compositeUrl`/`compositeKey` when the photo URLs are missing.

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
