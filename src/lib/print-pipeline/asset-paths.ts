/**
 * Single source of truth for every static asset the print-pipeline
 * processors read at server runtime.
 *
 * UAT-3 B5 context: spotify/studio/polaroid/tonos previously read from
 * `mosaic-categories/` and `MOSAIKO-logos/` — directories that were
 * never committed to git, so Vercel hit `ENOENT` the first time a real
 * customer hit "Agregar al carrito". The fix migrated those reads to
 * `public/templates/` + `public/logos/` (matching arte.ts), which Next.js
 * auto-bundles into the Vercel function output.
 *
 * Centralizing the paths here means:
 *   - The processors and the integrity test both import from this one
 *     module, eliminating the drift Codex's audit warned about
 *     (test inventory passing while processor reverts to legacy path).
 *   - Renames or relocations are a single-file change.
 *   - Any future asset shows up under public/ by construction.
 */
import { join } from 'node:path';

// `process.cwd()` is the project root on both dev and Vercel function
// invocations, so this resolves identically across environments.
const ROOT = process.cwd();

const TEMPLATE_BASE = join(ROOT, 'public', 'templates');
const LOGO_BASE = join(ROOT, 'public', 'logos');

/** Mosaiko brand logos shared across multiple categories. */
export const SHARED_LOGOS = {
  blanco: join(LOGO_BASE, 'logo-blanco.png'),
  negro: join(LOGO_BASE, 'logo-negro.png'),
} as const;

/** Per-category print-template assets. Keep the tile lists in numeric order
 *  matching the layout's tile indices; processors iterate `1..N` to load them. */
export const TEMPLATE_PATHS = {
  spotify: {
    dir: join(TEMPLATE_BASE, 'spotify'),
    tiles: [1, 2, 3, 4, 5, 6].map((n) =>
      join(TEMPLATE_BASE, 'spotify', `${n}.png`),
    ),
    /** Spotify-branded logo overlay used on tile 6. Category-specific
     *  print art, distinct from the shared Mosaiko logo. */
    spotifyLogo: join(TEMPLATE_BASE, 'spotify', 'logo-spotify.png'),
  },
  studio: {
    dir: join(TEMPLATE_BASE, 'studio'),
    tiles: [1, 2, 3, 4, 5, 6].map((n) =>
      join(TEMPLATE_BASE, 'studio', `${n}.png`),
    ),
  },
  polaroid: {
    dir: join(TEMPLATE_BASE, 'polaroid'),
    tiles: [1, 2, 3, 4].map((n) =>
      join(TEMPLATE_BASE, 'polaroid', `${n}.png`),
    ),
  },
} as const;
