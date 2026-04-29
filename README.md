# Mosaiko

**Transforma tus recuerdos en arte magnetico** — Transform your memories into magnetic art

[![Next.js](https://img.shields.io/badge/Next.js-16-black?style=flat-square&logo=next.js)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-4-06B6D4?style=flat-square&logo=tailwindcss&logoColor=white)](https://tailwindcss.com/)
[![Shopify](https://img.shields.io/badge/Shopify-checkout-95BF47?style=flat-square&logo=shopify&logoColor=white)](https://shopify.dev/)
[![License](https://img.shields.io/badge/License-Private-red?style=flat-square)]()

---

Mosaiko is a custom ecommerce platform where customers upload a personal photo, choose a mosaic grid layout (3, 4, 6, or 9 pieces), crop and adjust their image, and order printed fridge magnets that assemble into a complete picture. Built for the Mexican market with a warm, modern aesthetic inspired by Mexican design traditions.

## Features

- **Photo Upload & Crop** — Drag-and-drop image upload with an intuitive cropping interface powered by react-easy-crop
- **Mosaic Grid Builder** — Choose from 3, 4, 6, or 9-piece grid layouts and preview the split in real time
- **Canvas-Based Image Splitting** — HTML5 Canvas API slices the cropped image into individual magnet tiles, ready for print
- **Shopping Cart** — Add multiple mosaic designs, adjust quantities, and review before checkout
- **Bilingual (ES/EN)** — Spanish-first UI with full English support via next-intl, defaulting to the `es` locale
- **Mobile-First Design** — Every component is designed for touch devices first, then scales gracefully to desktop
- **Smooth Animations** — Staggered reveals, spring-based interactions, and fluid page transitions with Framer Motion
- **Product Categories** — Seven curated flows: Mosaicos, Studio, Arte, Save the Date, Tonos, Spotify, and Polaroid — each with its own crop geometry, overlay template, and print pipeline
- **Server-Side Print Pipeline** — Sharp-based processors generate per-tile PNGs at print resolution (827 px) with category-specific frame compositing
- **Shopify Checkout** — Cart attributes carry custom crop/upload metadata; Storefront API creates the checkout, Admin API receives fulfillment webhooks

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | [Next.js 16](https://nextjs.org/) (App Router) |
| Language | [TypeScript 5](https://www.typescriptlang.org/) |
| Styling | [Tailwind CSS 4](https://tailwindcss.com/) + CSS custom properties |
| Animations | [Framer Motion](https://www.framer.com/motion/) |
| State | [Zustand](https://zustand.docs.pmnd.rs/) |
| Image Crop | [react-easy-crop](https://github.com/ValentinH/react-easy-crop) |
| Client Split | HTML5 Canvas API |
| Print Pipeline | [Sharp](https://sharp.pixelplumbing.com/) + SVG overlays |
| Commerce | [Shopify](https://shopify.dev/) (Storefront + Admin APIs) |
| Image Storage | [Cloudflare R2](https://www.cloudflare.com/developer-platform/r2/) |
| Email | [Resend](https://resend.com/) |
| Auth (admin) | bcryptjs + jose (JWT cookies) |
| i18n | [next-intl](https://next-intl-docs.vercel.app/) |
| Hosting | [Vercel](https://vercel.com/) |

## Getting Started

### Prerequisites

- Node.js 18.17+
- npm, yarn, pnpm, or bun

### Installation

```bash
# Clone the repository
git clone https://github.com/ekasisprog-bit/mosaiko.git
cd mosaiko

# Install dependencies
npm install
```

### Development

```bash
# Start the dev server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### Build

```bash
# Production build
npm run build

# Start production server
npm run start
```

### Lint

```bash
npm run lint
```

## Project Structure

```
src/
  app/
    [locale]/                # Locale-aware routes (es, en)
      page.tsx                 # Homepage
      personalizar/            # Magnet builder
      carrito/                 # Cart
      catalogo/                # Catalog + category filter
      pedido-confirmado/       # Order confirmation
      terminos/ privacidad/    # Legal pages
      ...
    admin/                   # Admin panel (always Spanish, auth-gated)
    api/                     # Route handlers (checkout, webhooks, print)
  components/
    builder/                 # Magnet builder flow
      CategorySelector.tsx     #   Step 1
      PhotoUploader.tsx        #   Step 2
      ImageCropper.tsx         #   Step 3 — per-category aspect + overlay
      CustomizationEditor.tsx  #   Step 4 — text panels, Tonos intensity
      MagnetPreview.tsx        #   Step 5 — live tile preview
      MagnetBuilder.tsx        #   Orchestrator (Zustand flow state)
      tile-previews/           #   Per-category tile render components
    cart/                    # CartDrawer, CartPage, CartItem
    home/                    # Hero, HowItWorks, FeaturedCategories, etc.
    layout/                  # Header, Footer, AnnouncementBar
    ui/                      # Button, Badge, Container primitives
  lib/
    canvas-utils.ts          # Client-side image split
    cart-store.ts            # Zustand cart
    grid-config.ts           # Category + grid-size layout overrides
    customization-types.ts   # Per-category discriminated union
    catalog-data.ts          # Pre-designed product catalog
    print-pipeline/          # Sharp-based server processors
      processors/               # mosaicos / spotify / tonos / save-the-date /
      utils/                    # arte / studio / polaroid
    shopify/                 # Storefront + Admin clients, cart mutations
    r2/                      # Cloudflare R2 upload helpers
  messages/                  # ES + EN translations (next-intl)
  middleware.ts              # Locale routing
public/
  templates/                 # Per-category PNG frame overlays
  products/                  # Pre-designed product thumbnails
  categories/                # Category cover images
```

## Design System

### Color Palette

| Token | Color | Hex |
|---|---|---|
| Terracotta | Primary warm tone | `#C4603C` |
| Deep Teal | Primary cool accent | `#1A5C5E` |
| Marigold Gold | Highlight / CTA | `#E8A838` |
| Warm Cream | Background base | `#FDF6EC` |

### Typography

- **Headings** — Playfair Display (serif, editorial warmth)
- **Body** — DM Sans (clean, highly readable)

### Principles

The design language blends Mexican warmth with modern ecommerce clarity. Every color, animation, and spacing decision is intentional — no generic templates, no filler.

## Architecture

Mosaiko is a **Shopify-backed storefront**: the custom Next.js frontend handles the photo builder experience, then hands off to Shopify's hosted checkout with custom cart attributes carrying the user's uploads and crop metadata. Shopify is the source of truth for orders, customers, and payments; print files live in Cloudflare R2 and are referenced via Shopify metafields. There is no separate app database.

```
User photo ─► Cloudflare R2 (originals bucket)
      ▼
 Crop / customize ─► Shopify cart (attributes)
      ▼
 Shopify checkout (OXXO / SPEI / cards, PCI-compliant)
      ▼
 order webhook ─► Next.js /api/print ─► Sharp pipeline
      ▼                                      ▼
 Email (Resend)                     R2 (print-files bucket)
      ▼                                      ▼
              Admin panel ZIP download by order
```

## Testing & Quality

- **`npm test`** — Vitest 144/144 passing. Integration tests under `src/__tests__/integrity/` cover the full builder → cart → webhook → print pipeline data flow with fixture-based mocks.
- **`npm run build`** — clean Next.js production build.
- **`tsc --noEmit`** — strict TypeScript across the codebase.
- **Codex audits** — every architectural change ran through paired Claude + Codex review (pre-merge cumulative + per-phase rounds). Findings captured in [`INTEGRITY_AUDIT.md`](./INTEGRITY_AUDIT.md).

```bash
npm test                # Run integrity test suite
npm run test:watch      # Watch mode
npm run test:coverage   # With coverage report
```

## Operational scripts

Located in `scripts/`. All dry-run by default; require `--apply` to mutate.

- **`scripts/cleanup-stale-metafields.mts`** — removes duplicate Shopify metafield rows from the legacy REST-create loop (keeps newest per `(namespace, key)`). Uses REST DELETE-by-ID since GraphQL `metafieldsDelete` is by-tuple.
- **`scripts/cleanup-orphan-r2-tiles.mts`** — removes R2 print-tile objects no longer referenced from any order's metafield. Fail-closed on canonical-URL parse failure (defends against env-var mismatch deleting live data).
- **`scripts/measure-frame-templates.ts`** — measures transparent-cutout bounds in template PNGs for Polaroid/Studio/Spotify so `frame.photo.tiles` constants stay in sync with the actual artwork.
- **`scripts/font-spike.mts`** — Phase 4.0 spike that confirmed `@napi-rs/canvas` was the only viable path for server-side font fidelity (librsvg ignores embedded `@font-face`).

## Project Roadmap

### Phase 1 — Storefront Foundation ✓
- Landing page (hero, how-it-works, featured categories, trust badges, CTA)
- Magnet builder: category → upload → crop → customize → preview
- Seven category flows with per-category crop aspects, overlay templates, and print pipelines
- Shopping cart with Zustand + persistence
- Bilingual (ES/EN) mobile-first UI

### Phase 2 — Checkout & Fulfillment ✓
- Shopify Storefront API checkout (OXXO, SPEI, cards)
- Cart attributes carry R2 upload URLs + crop metadata
- Order webhook triggers Sharp print pipeline per category
- Resend emails: order confirmation, admin notification, shipping

### Phase 3 — Admin Panel ✓ (core)
- bcrypt + JWT cookie auth (single admin user via env var)
- Order list with status tabs (Todos / Nuevos / Imprimiendo / Enviados / Entregados)
- Order detail: customer info, product preview, status pipeline, print-file ZIP downloads
- Onboarding overlay for non-technical client

### Phase 4 — Foundation Refactor ✓
- Centralized `CategoryLayout` contract (`src/lib/category-layouts/`) — single source of truth for grid dimensions, crop aspects, tile descriptors, frame geometry, and overlay specs across every category.
- Polaroid + Studio + Spotify geometry reconciliation (cropper aspect matches measured template-PNG transparent area).
- `<Overlay>` primitive (Radix Dialog + react-remove-scroll) replacing 8 ad-hoc body-scroll-lock implementations.
- Platform tokens: `viewport`, safe-area utilities, z-index variables, `touch-action` on cropper.

### Phase 5 — Mobile UX Polish ✓
- Sticky bottom CTA on builder steps with iOS soft-keyboard inset (`useKeyboardInset`)
- Explicit upload phases (idle / processing / ready / failed) with retry
- Cropper toolbar (Restablecer / Centrar / Cambiar foto) on single + Tonos slots
- Cart polish: 48 px touch targets, expectation copy, Shopify-explicit checkout button
- Home + catalog rulebook compliance

### Phase 6 — Pipeline Integrity ✓
- 7 BLOCKERs + 4 MAJORs + 2 MINORs found and fixed, every finding pinned by a vitest case
- `metafieldsSet` atomic upsert; `Promise.allSettled` + `UploadFailure`; per-line idempotency
- Server-side font fidelity via `@napi-rs/canvas` + 10 bundled `@fontsource` WOFF2s
- Tonos `fitMode` end-to-end (cream letterbox in preview ↔ print)
- Composite-reuse: cart-composite skipped at webhook time when `_composite_pipeline_version` matches
- Admin print-files R2 gate (downloads only when `print_pipeline_status === 'complete'`)
- Cart-thumbnail durability (filesystem-backed dev composite cache)
- New `/carrito/[itemId]` cart-item detail view with shared `<TileGrid>` extracted from catalog

### Phase 7 — Shopify Integration (next)
- Client provisions Shopify store + custom app + webhook secret (see [`SHOPIFY_SETUP.md`](./SHOPIFY_SETUP.md))
- Run end-to-end test order
- Iterate on admin from real-order signal

### Phase 8 — Launch Polish (post-integration)
- Admin: retry UI, fulfillment + tracking entry, settings/health-check page
- Shopify metaobjects as content CMS (catalog products, hero copy)
- GA4 event helpers + analytics dashboard
- SEO, structured data, Open Graph
- Custom domain on Vercel

---

## Documentation

| File | Purpose |
|---|---|
| [`README.md`](./README.md) | This file — overview + quickstart |
| [`SHOPIFY_SETUP.md`](./SHOPIFY_SETUP.md) | Step-by-step client checklist for connecting a Shopify store |
| [`CLAUDE.md`](./CLAUDE.md) | Project instructions for AI-assisted development |
| [`INTEGRITY_AUDIT.md`](./INTEGRITY_AUDIT.md) | Full pipeline-integrity audit report with severity-sorted findings + test coverage map |
| [`DEFERRED.md`](./DEFERRED.md) | Intentionally-scoped-out work; what's waiting on the client vs post-launch roadmap |
| [`COSTOS-MENSUALES.md`](./COSTOS-MENSUALES.md) | Estimated monthly costs (Shopify, Cloudflare R2, Resend, Vercel) |

---

<p align="center">
  Built with care by <a href="https://outerhaven.mx"><strong>Outer Haven</strong></a>
</p>
