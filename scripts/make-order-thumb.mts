/**
 * Generate the branded order-history thumbnail: the Mosaiko wordmark centered
 * on a cream square. Used as the Shopify product image so order cards (Shop
 * customer account + Shopify admin) show a branded tile instead of a gray
 * placeholder. Purely cosmetic, Shopify-side only.
 *
 * Run: npx tsx scripts/make-order-thumb.mts
 */
import sharp from 'sharp';

const SIZE = 1200; // square
const CREAM = { r: 0xef, g: 0xeb, b: 0xe0, alpha: 1 }; // --cream #efebe0
const LOGO = 'MOSAIKO-logos/LOGO NEGRO.png'; // charcoal wordmark, transparent bg
const WORDMARK_WIDTH_RATIO = 0.68; // generous padding so strokes aren't thin
const OUT = '.brand-order-thumb.png';

async function main() {
  const targetW = Math.round(SIZE * WORDMARK_WIDTH_RATIO);
  const logo = await sharp(LOGO).resize({ width: targetW }).png().toBuffer();
  const meta = await sharp(logo).metadata();
  const left = Math.round((SIZE - (meta.width ?? targetW)) / 2);
  const top = Math.round((SIZE - (meta.height ?? 0)) / 2);

  await sharp({
    create: { width: SIZE, height: SIZE, channels: 4, background: CREAM },
  })
    .composite([{ input: logo, left, top }])
    .png()
    .toFile(OUT);

  console.log(`✓ wrote ${OUT}  (${SIZE}×${SIZE}, wordmark ${meta.width}×${meta.height} centered)`);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
