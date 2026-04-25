/**
 * Phase 4.0 spike — does Sharp/librsvg pick up @font-face data URIs?
 *
 * Renders a fixed SVG four ways and pixel-hashes each output:
 *
 *   baseline       — font-family the OS doesn't have, no embedding.
 *                    Establishes the "fallback render" hash.
 *   variantA       — same SVG with @font-face inside <defs><style>, body
 *                    (woff2 base64). Tests librsvg's ability to honour
 *                    embedded fonts. Codex's local probe suggested this
 *                    fails on Sharp 0.34.x.
 *   variantC       — same SVG, no embedding, but FONTCONFIG_PATH points
 *                    at a directory containing the TTF and a fonts.conf
 *                    that adds it. Tests Sharp/librsvg picking up custom
 *                    fonts via fontconfig (the supported Vercel pattern).
 *   variantSystem  — render with `<text font-family="sans-serif">` to
 *                    confirm fontconfig itself works at all (sanity).
 *
 * The font used is `Noto Sans` (the bundled one in
 * `next/dist/compiled/@vercel/og/`) renamed to a unique family name
 * `MosaikoSpikeFont` so we can be sure ANY change in pixels is due to
 * our embedding/registration — no system fallback collides with a real
 * "Noto Sans" install.
 *
 * Output: a small JSON report on stdout listing the SHA-256 of each
 * variant's text-region pixels. Variants whose hash differs from the
 * baseline = font-loaded. Pick the cheapest variant that loaded.
 *
 * Run: `npx tsx scripts/font-spike.mts`
 */

import sharp from 'sharp';
import { readFileSync, writeFileSync, mkdtempSync, rmSync, mkdirSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';

const FONT_TTF_PATH = join(
  process.cwd(),
  'node_modules/next/dist/compiled/@vercel/og/noto-sans-v27-latin-regular.ttf',
);

const SVG_WIDTH = 600;
const SVG_HEIGHT = 200;
const TEXT = 'Mosaiko AaBb';
const UNIQUE_FAMILY = 'MosaikoSpikeFont';

function buildSvg(opts: {
  fontFamily: string;
  fontFaceCss?: string; // CSS @font-face block to embed in <defs><style>
}): string {
  const defs = opts.fontFaceCss
    ? `<defs><style type="text/css">${opts.fontFaceCss}</style></defs>`
    : '';
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${SVG_WIDTH}" height="${SVG_HEIGHT}">
  ${defs}
  <rect x="0" y="0" width="${SVG_WIDTH}" height="${SVG_HEIGHT}" fill="white"/>
  <text x="${SVG_WIDTH / 2}" y="${SVG_HEIGHT / 2}"
        font-family="${opts.fontFamily}"
        font-size="60"
        text-anchor="middle"
        fill="black">${TEXT}</text>
</svg>`;
}

async function svgToPng(svg: string): Promise<Buffer> {
  return sharp(Buffer.from(svg, 'utf8')).png().toBuffer();
}

async function pixelHash(png: Buffer): Promise<string> {
  // Hash raw RGBA pixels so we ignore PNG container metadata variance.
  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
  return createHash('sha256').update(data).digest('hex') + `:${info.width}x${info.height}`;
}

async function variantBaseline(): Promise<{ name: string; hash: string }> {
  // Reference for the spike: missing font + no fallback specified.
  // Whatever librsvg picks is the "no font available" baseline. If
  // variantA/C produce a different hash, they successfully loaded a font.
  const svg = buildSvg({ fontFamily: UNIQUE_FAMILY });
  const png = await svgToPng(svg);
  return { name: 'baseline (missing font, no embedding)', hash: await pixelHash(png) };
}

async function variantA(): Promise<{ name: string; hash: string }> {
  // Embed @font-face data URI inside <defs><style>. Codex's local probe
  // suggested librsvg may ignore this. Confirm here.
  const ttf = readFileSync(FONT_TTF_PATH);
  const b64 = ttf.toString('base64');
  const fontFaceCss = `@font-face { font-family: '${UNIQUE_FAMILY}'; src: url('data:font/ttf;base64,${b64}') format('truetype'); font-weight: normal; font-style: normal; }`;
  const svg = buildSvg({ fontFamily: UNIQUE_FAMILY, fontFaceCss });
  const png = await svgToPng(svg);
  return { name: 'variantA (@font-face data URI)', hash: await pixelHash(png) };
}

async function variantC(): Promise<{ name: string; hash: string }> {
  // FONTCONFIG_PATH approach. libvips initializes fontconfig once per
  // process, so the env var MUST be set before the Node process starts.
  // We fork a child process with the env preset, render the SVG there,
  // and read the hash back via stdout.
  const { spawnSync } = await import('node:child_process');
  const tmp = mkdtempSync(join(tmpdir(), 'mosaiko-fontspike-'));
  try {
    const fontDir = join(tmp, 'fonts');
    mkdirSync(fontDir);
    copyFileSync(FONT_TTF_PATH, join(fontDir, 'mosaiko-spike.ttf'));
    // fonts.conf maps the unique family name to the bundled TTF via
    // an alias. fontconfig's `<dir>` element scans the directory and
    // exposes its fonts under whatever family the TTF actually carries
    // (Noto Sans here); the alias re-binds our requested family name
    // to that real one so SVG text-anchor `font-family="${UNIQUE_FAMILY}"`
    // resolves to a real glyph table.
    const fontsConf = `<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "fonts.dtd">
<fontconfig>
  <dir>${fontDir}</dir>
  <alias>
    <family>${UNIQUE_FAMILY}</family>
    <prefer><family>Noto Sans</family></prefer>
  </alias>
</fontconfig>`;
    writeFileSync(join(tmp, 'fonts.conf'), fontsConf);

    const childScript = `
import sharp from 'sharp';
import { createHash } from 'node:crypto';
const SVG_WIDTH = ${SVG_WIDTH};
const SVG_HEIGHT = ${SVG_HEIGHT};
const TEXT = ${JSON.stringify(TEXT)};
const UNIQUE_FAMILY = ${JSON.stringify(UNIQUE_FAMILY)};
const svg = \`<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="\${SVG_WIDTH}" height="\${SVG_HEIGHT}">
  <rect x="0" y="0" width="\${SVG_WIDTH}" height="\${SVG_HEIGHT}" fill="white"/>
  <text x="\${SVG_WIDTH/2}" y="\${SVG_HEIGHT/2}" font-family="\${UNIQUE_FAMILY}" font-size="60" text-anchor="middle" fill="black">\${TEXT}</text>
</svg>\`;
const png = await sharp(Buffer.from(svg, 'utf8')).png().toBuffer();
const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
console.log(createHash('sha256').update(data).digest('hex') + ':' + info.width + 'x' + info.height);
`;
    // Write child script inside the project so tsx's import resolver
    // finds `sharp` in our node_modules. The `tmp` dir is outside the
    // project root and ESM resolves package imports relative to the
    // importer's location.
    const childPath = join(process.cwd(), 'scripts', `_font-spike-child-${process.pid}.mts`);
    writeFileSync(childPath, childScript);

    const r = spawnSync('npx', ['tsx', childPath], {
      env: {
        ...process.env,
        FONTCONFIG_PATH: tmp,
      },
      cwd: process.cwd(),
      encoding: 'utf8',
    });
    rmSync(childPath, { force: true });
    if (r.status !== 0) {
      return {
        name: 'variantC (FONTCONFIG_PATH, child process)',
        hash: `ERROR: ${r.stderr.slice(0, 200)}`,
      };
    }
    return {
      name: 'variantC (FONTCONFIG_PATH, child process)',
      hash: r.stdout.trim(),
    };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

async function variantB(fontPath: string, label: string): Promise<{ name: string; hash: string }> {
  // @napi-rs/canvas with registerFont. Canvas is a separate render
  // pipeline from Sharp/librsvg — it has its own font registry that
  // accepts a font file path (TTF/OTF/WOFF/WOFF2). If this works, we
  // can render text-bearing SVG elements via canvas, then
  // Sharp.composite() the canvas PNG onto the rest of the pipeline output.
  const canvas = await import('@napi-rs/canvas');
  const family = `${UNIQUE_FAMILY}-${label}`;
  canvas.GlobalFonts.registerFromPath(fontPath, family);
  const c = canvas.createCanvas(SVG_WIDTH, SVG_HEIGHT);
  const ctx = c.getContext('2d');
  ctx.fillStyle = 'white';
  ctx.fillRect(0, 0, SVG_WIDTH, SVG_HEIGHT);
  ctx.fillStyle = 'black';
  ctx.font = `60px ${family}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(TEXT, SVG_WIDTH / 2, SVG_HEIGHT / 2);
  const png = c.toBuffer('image/png');
  return { name: `variantB (@napi-rs/canvas registerFont, ${label})`, hash: await pixelHash(png) };
}

async function variantSystem(): Promise<{ name: string; hash: string }> {
  // Render with `sans-serif` as a sanity check that fontconfig itself
  // is wired up and rendering SOME font. If this hash matches the
  // baseline, librsvg is rendering nothing or everything as the same
  // fallback — the font-family attribute is being ignored entirely.
  const svg = buildSvg({ fontFamily: 'sans-serif' });
  const png = await svgToPng(svg);
  return { name: 'variantSystem (font-family="sans-serif")', hash: await pixelHash(png) };
}

async function variantNoText(): Promise<{ name: string; hash: string }> {
  // Sanity: SVG with NO <text> element. Hash should differ from
  // baseline if the text was actually rendering. If it matches, our
  // baseline already has no rendered text → librsvg is no-oping the
  // text element entirely (no font means no glyphs).
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${SVG_WIDTH}" height="${SVG_HEIGHT}">
  <rect x="0" y="0" width="${SVG_WIDTH}" height="${SVG_HEIGHT}" fill="white"/>
</svg>`;
  const png = await svgToPng(svg);
  return { name: 'variantNoText (white rect, no text element)', hash: await pixelHash(png) };
}

async function main() {
  const results = await Promise.all([
    variantBaseline(),
    variantNoText(),
    variantA(),
    variantB(FONT_TTF_PATH, 'TTF'),
    variantB(
      join(
        process.cwd(),
        'node_modules/@fontsource/playfair-display/files/playfair-display-latin-700-normal.woff2',
      ),
      'WOFF2',
    ),
    variantC(),
    variantSystem(),
  ]);
  console.log(JSON.stringify(results, null, 2));
  console.log('\n--- analysis ---');
  const baselineHash = results[0].hash;
  for (const r of results.slice(1)) {
    const sameAsBaseline = r.hash === baselineHash;
    console.log(`${r.name}: ${sameAsBaseline ? 'SAME as baseline (font NOT loaded)' : 'DIFFERS from baseline (font loaded ✓)'}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
