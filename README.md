# Mosaiko

**Transforma tus recuerdos en arte magnetico** — Transform your memories into magnetic art

[![Next.js](https://img.shields.io/badge/Next.js-15-black?style=flat-square&logo=next.js)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-4-06B6D4?style=flat-square&logo=tailwindcss&logoColor=white)](https://tailwindcss.com/)
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
- **Product Categories** — Curated collections including Mosaicos, Studio, Arte, Save the Date, Flores, Album de Spotify, and Polaroid

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | [Next.js 15](https://nextjs.org/) (App Router) |
| Language | [TypeScript 5](https://www.typescriptlang.org/) |
| Styling | [Tailwind CSS 4](https://tailwindcss.com/) + CSS custom properties |
| Animations | [Framer Motion](https://www.framer.com/motion/) |
| State | [Zustand](https://zustand.docs.pmnd.rs/) |
| Image Crop | [react-easy-crop](https://github.com/ValentinH/react-easy-crop) |
| Image Split | HTML5 Canvas API |
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
    [locale]/              # Locale-aware routes (es, en)
      page.tsx             # Homepage
      personalizar/        # Magnet builder page
      carrito/             # Cart page
    globals.css            # Global styles & design tokens
    layout.tsx             # Root layout
  components/
    builder/               # Magnet builder flow
      PhotoUploader.tsx    #   Upload step
      ImageCropper.tsx     #   Crop & adjust step
      GridSelector.tsx     #   Grid layout picker
      MagnetPreview.tsx    #   Live mosaic preview
      MagnetBuilder.tsx    #   Builder orchestrator
    cart/                  # Shopping cart
    home/                  # Landing page sections
    layout/                # Header, Footer, AnnouncementBar
    ui/                    # Reusable primitives (Button, Badge, Container)
  i18n/                    # Internationalization config
  lib/
    canvas-utils.ts        # Image splitting logic
    cart-store.ts          # Zustand cart state
    grid-config.ts         # Grid layout definitions
  messages/
    es.json                # Spanish translations
    en.json                # English translations
  middleware.ts            # Locale detection & routing
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

## Roadmap

### Phase 1 — Storefront Foundation &#10003;
- Landing page with hero, how-it-works, featured categories, trust badges, and CTA
- Magnet builder: upload, crop, grid select, live preview
- Shopping cart with state management
- Bilingual support (ES/EN)
- Mobile-first responsive layout

### Phase 2 — Payments & Orders
- Stripe Mexico integration (cards, OXXO, SPEI)
- Order creation and confirmation flow
- Email notifications via Resend

### Phase 3 — Admin Panel
- Content management for all site sections
- Product and category CRUD
- Order management with print file downloads
- Analytics dashboard (GA4 + Google Ads)

### Phase 4 — Backend & Auth
- Supabase integration (Postgres, Storage, Auth)
- User accounts and order history
- Image storage and print-ready file generation

### Phase 5 — Polish & Launch
- SEO optimization and structured data
- Legal pages (Terms, Privacy, Cookies)
- Performance audits and Lighthouse tuning
- Production deployment on Vercel

---

<p align="center">
  Built with care by <a href="https://outerhaven.mx"><strong>Outer Haven</strong></a>
</p>
