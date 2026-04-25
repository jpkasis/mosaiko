/**
 * Phase 4 — Server-side font fidelity. Registers all print-pipeline
 * fonts with @napi-rs/canvas at module-import time, so subsequent
 * `ctx.font = '60px Playfair Display'` calls in the canvas-text
 * renderer pick up the bundled WOFF2 instead of falling back to a
 * libvips DejaVu/Liberation Sans default.
 *
 * Why canvas (not librsvg @font-face): the Phase 4.0 spike
 * (`scripts/font-spike.mts`) confirmed librsvg ignores embedded
 * `@font-face` data URIs in SVG strings — the print PNG would still
 * render with whatever system font Sharp/libvips defaulted to. Canvas
 * has its own font registry that accepts WOFF2 directly and is
 * cross-platform (mac dev + Linux Vercel).
 *
 * Fonts come from @fontsource/* packages — the WOFF2 files at
 * `node_modules/@fontsource/<family>/files/<family>-latin-<weight>-normal.woff2`.
 * No TTF conversion required (canvas accepts WOFF2 natively).
 *
 * Module-level registration follows vercel:react-best-practices'
 * `server-hoist-static-io` pattern: the I/O happens once at module
 * import (cold-start cost) and the registry persists for the lifetime
 * of the function instance.
 *
 * Bundle impact: ~50–60KB per Latin family × 14 weights ≈ ~800KB.
 * Noto Sans JP japanese subset 400-normal is ~1.2MB. Total ~2MB.
 * @napi-rs/canvas binary adds ~3MB. Vercel's 50MB function cap is
 * comfortably under.
 */
import { GlobalFonts } from '@napi-rs/canvas';
import { join } from 'node:path';

const FONTSOURCE_BASE = join(process.cwd(), 'node_modules', '@fontsource');

interface FontEntry {
  /** The package name segment under @fontsource. */
  pkg: string;
  /** The CSS family name as written in SVGs/processors. Must match
   *  exactly what processors set via `ctx.font = '<size>px <family>'`. */
  family: string;
  /** Subset (latin / japanese / etc) — picks the WOFF2 file's middle segment. */
  subset: 'latin' | 'japanese';
  /** Font weights to register — each maps to a separate WOFF2 file. */
  weights: number[];
}

const FONT_REGISTRY: readonly FontEntry[] = [
  // STD selectable families (`STD_FONT_FAMILIES` in customization-types).
  // 400 + 700 covers regular + bold for every treatment.
  { pkg: 'cormorant-garamond', family: 'Cormorant Garamond', subset: 'latin', weights: [400, 700] },
  { pkg: 'playfair-display', family: 'Playfair Display', subset: 'latin', weights: [400, 700] },
  { pkg: 'montserrat', family: 'Montserrat', subset: 'latin', weights: [400, 700] },
  { pkg: 'dm-sans', family: 'DM Sans', subset: 'latin', weights: [400, 700] },
  { pkg: 'dancing-script', family: 'Dancing Script', subset: 'latin', weights: [400, 700] },
  // Great Vibes ships only 400.
  { pkg: 'great-vibes', family: 'Great Vibes', subset: 'latin', weights: [400] },
  { pkg: 'cinzel', family: 'Cinzel', subset: 'latin', weights: [400, 700] },
  // Tenor Sans ships only 400.
  { pkg: 'tenor-sans', family: 'Tenor Sans', subset: 'latin', weights: [400] },
  // Spotify processor uses Source Sans 3 (`spotify.ts:100-101`):
  // 56px bold for songName, 40px regular for artistName.
  { pkg: 'source-sans-3', family: 'Source Sans 3', subset: 'latin', weights: [400, 700] },
  // Studio japaneseText layer (`studio.ts:195`). 400 is enough for
  // the Spirited-Away-style subhead — we don't need bold CJK.
  { pkg: 'noto-sans-jp', family: 'Noto Sans JP', subset: 'japanese', weights: [400] },
] as const;

function resolveWoff2Path(entry: FontEntry, weight: number): string {
  // @fontsource path convention: `<pkg>/files/<pkg>-<subset>-<weight>-normal.woff2`.
  // Subset segment is `latin` for Latin scripts and `japanese` for Noto Sans JP.
  return join(
    FONTSOURCE_BASE,
    entry.pkg,
    'files',
    `${entry.pkg}-${entry.subset}-${weight}-normal.woff2`,
  );
}

let registered = false;

/**
 * Ensures all print-pipeline fonts are registered with the canvas
 * GlobalFonts singleton. Idempotent — safe to call from multiple
 * processors. The first call does the I/O; subsequent calls are O(1).
 *
 * Throws if any required font file is missing. Intentional: a missing
 * font would cause silent fallback to a system default and re-introduce
 * the very preview/print divergence Phase 4 is meant to fix. Better to
 * fail loudly at first invocation than ship wrong-font tiles.
 */
export function ensurePrintFontsRegistered(): void {
  if (registered) return;
  for (const entry of FONT_REGISTRY) {
    for (const weight of entry.weights) {
      const path = resolveWoff2Path(entry, weight);
      // GlobalFonts.registerFromPath returns boolean (false = font not
      // loaded). Throw on any failure so the caller learns about a
      // missing dep instead of getting silently-wrong glyphs.
      const ok = GlobalFonts.registerFromPath(path, entry.family);
      if (!ok) {
        throw new Error(
          `[font-loader] Failed to register font: ${entry.family} ${weight} from ${path}`,
        );
      }
    }
  }
  registered = true;
}

/**
 * Returns the list of registered family names. Useful for tests and
 * for processors that want to assert font availability before building
 * their canvas calls.
 */
export function listRegisteredFamilies(): readonly string[] {
  return FONT_REGISTRY.map((e) => e.family);
}
