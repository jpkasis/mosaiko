/**
 * UAT-3 B5 contract test: every static asset path that print-pipeline
 * processors read at server runtime MUST resolve to a file that ships in
 * `public/` (which Vercel auto-includes in the function output).
 *
 * Background: spotify/studio/polaroid/tonos previously read from
 * `mosaic-categories/` + `MOSAIKO-logos/` — directories that were never
 * committed to git, so Vercel deploys hit `ENOENT: no such file or
 * directory, open '/var/task/mosaic-categories/...'` the moment a real
 * customer hit "Agregar al carrito" on those categories.
 *
 * Codex audit fix (centralization): we import the asset paths from the
 * SAME module the processors use (`src/lib/print-pipeline/asset-paths.ts`).
 * If a processor reverts to a legacy `mosaic-categories/` path while
 * leaving the central module untouched, the processor will throw at
 * runtime — but more importantly, the central module is the single
 * source of truth, so there's nowhere for the inventory to drift.
 */
import { describe, test, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SHARED_LOGOS, TEMPLATE_PATHS } from '@/lib/print-pipeline/asset-paths';

const REPO_ROOT = resolve(__dirname, '../../..');
const PUBLIC_PREFIX = resolve(REPO_ROOT, 'public') + '/';

// Flatten everything the central module exports into [label, path] pairs.
const ALL_PATHS: ReadonlyArray<readonly [string, string]> = [
  ['SHARED_LOGOS.blanco', SHARED_LOGOS.blanco],
  ['SHARED_LOGOS.negro', SHARED_LOGOS.negro],
  ...TEMPLATE_PATHS.spotify.tiles.map(
    (p, i) => [`TEMPLATE_PATHS.spotify.tiles[${i}]`, p] as const,
  ),
  ['TEMPLATE_PATHS.spotify.spotifyLogo', TEMPLATE_PATHS.spotify.spotifyLogo],
  ...TEMPLATE_PATHS.studio.tiles.map(
    (p, i) => [`TEMPLATE_PATHS.studio.tiles[${i}]`, p] as const,
  ),
  ...TEMPLATE_PATHS.polaroid.tiles.map(
    (p, i) => [`TEMPLATE_PATHS.polaroid.tiles[${i}]`, p] as const,
  ),
];

describe('Print pipeline asset paths — all resolve under public/ (UAT-3 B5)', () => {
  test.each(ALL_PATHS)('asset exists on disk: %s', (label, assetPath) => {
    expect(
      existsSync(assetPath),
      `Central asset registry references "${label}" → "${assetPath}" but the file does not exist. ` +
        `This will throw ENOENT in the Vercel function. Restore the asset under public/ or ` +
        `update the registry to point to a path that does exist.`,
    ).toBe(true);
  });

  test('every registered path lives under public/ (no legacy mosaic-categories/ or MOSAIKO-logos/)', () => {
    for (const [label, p] of ALL_PATHS) {
      expect(
        p.startsWith(PUBLIC_PREFIX),
        `Registry entry "${label}" = "${p}" is outside public/. ` +
          `UAT-3 B5: all runtime asset reads must come from public/ so Next.js auto-bundles ` +
          `them into the Vercel function output.`,
      ).toBe(true);
    }
  });

  test('expected processor coverage: spotify(6+1), studio(6), polaroid(4), shared logos(2)', () => {
    // Regression guard against accidental loss of an asset from the registry.
    expect(TEMPLATE_PATHS.spotify.tiles).toHaveLength(6);
    expect(TEMPLATE_PATHS.studio.tiles).toHaveLength(6);
    expect(TEMPLATE_PATHS.polaroid.tiles).toHaveLength(4);
    expect(TEMPLATE_PATHS.spotify.spotifyLogo).toBeTruthy();
    expect(SHARED_LOGOS.blanco).toBeTruthy();
    expect(SHARED_LOGOS.negro).toBeTruthy();
  });
});

/**
 * Codex audit fix (UAT-3 Phase 1 re-audit): static guard against a
 * processor reverting to legacy paths. Reads each processor's source and
 * asserts (a) it imports from `../asset-paths` and (b) its code (outside
 * comments) does NOT call `join(process.cwd(), 'mosaic-categories' | 'MOSAIKO-logos')`.
 * Comments referencing the legacy dirs as historical context are fine.
 */
describe('Print pipeline processors — registry usage (UAT-3 B5 static guard)', () => {
  const PROCESSOR_FILES = [
    'spotify.ts',
    'studio.ts',
    'polaroid.ts',
    'tonos.ts',
  ];

  function stripComments(src: string): string {
    // Strip `// ...` line comments and `/* ... */` block comments.
    // Cheap enough for a static guard; doesn't need to be a full parser.
    return src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
  }

  test.each(PROCESSOR_FILES)(
    '%s imports from ../asset-paths and has no legacy filesystem joins',
    (file) => {
      const src = readFileSync(
        resolve(__dirname, '../../lib/print-pipeline/processors/', file),
        'utf-8',
      );

      expect(
        src,
        `${file} must import from '../asset-paths' so all asset paths come from a single source of truth`,
      ).toMatch(/from\s+['"]\.\.\/asset-paths['"]/);

      const codeOnly = stripComments(src);

      expect(
        /join\s*\(\s*process\.cwd\(\)\s*,\s*['"]mosaic-categories['"]/.test(
          codeOnly,
        ),
        `${file} contains a live join(process.cwd(), 'mosaic-categories', ...) call — ` +
          `that's the path Codex flagged as production-breaking (ENOENT on Vercel). ` +
          `Use the centralized registry in asset-paths.ts instead.`,
      ).toBe(false);

      expect(
        /join\s*\(\s*process\.cwd\(\)\s*,\s*['"]MOSAIKO-logos['"]/.test(
          codeOnly,
        ),
        `${file} contains a live join(process.cwd(), 'MOSAIKO-logos', ...) call — ` +
          `that's the path Codex flagged as production-breaking (ENOENT on Vercel). ` +
          `Use the centralized registry in asset-paths.ts instead.`,
      ).toBe(false);
    },
  );
});
