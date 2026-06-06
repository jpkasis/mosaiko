/**
 * Associate the existing branded MediaImage with every variant of the v2 pricing
 * product, so Shopify surfaces that prioritize variant media (incl. the Shop
 * customer-account order view for FUTURE orders) resolve the Mosaiko tile.
 * product.featuredImage already covers the documented fallback; this removes
 * ambiguity (Codex recommendation). Idempotent: re-appending the same media is a
 * no-op. New orders go to v2, so v2 only.
 *
 * Run: npx tsx --env-file=.env.local scripts/set-variant-images.mts
 */
const API_VERSION = process.env.SHOPIFY_API_VERSION || '2026-04';
const PRODUCT_ID = 'gid://shopify/Product/9300378681582'; // v2
function mustEnv(k: string): string {
  const v = process.env[k];
  if (!v || v === 'placeholder') { console.error(`✗ Missing env: ${k}`); process.exit(1); }
  return v;
}
const STORE_DOMAIN = mustEnv('NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN');
async function getAdminToken(): Promise<string> {
  const s = process.env.SHOPIFY_ADMIN_API_TOKEN;
  if (s && s !== 'placeholder') return s;
  const res = await fetch(`https://${STORE_DOMAIN}/admin/oauth/access_token`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: mustEnv('SHOPIFY_CLIENT_ID'), client_secret: mustEnv('SHOPIFY_CLIENT_SECRET') }).toString(),
  });
  if (!res.ok) { console.error(`✗ token HTTP ${res.status}: ${await res.text()}`); process.exit(1); }
  return ((await res.json()) as { access_token: string }).access_token;
}
let TOKEN = '';
async function af<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(`https://${STORE_DOMAIN}/admin/api/${API_VERSION}/graphql.json`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': TOKEN },
    body: JSON.stringify({ query, variables }),
  });
  const json = (await res.json()) as { data?: T; errors?: Array<{ message: string }> };
  if (json.errors?.length) throw new Error(json.errors.map((e) => e.message).join('\n'));
  if (!json.data) throw new Error('No data');
  return json.data;
}

async function main() {
  TOKEN = await getAdminToken();
  console.log(`\n── Set variant images (v2) → ${STORE_DOMAIN} ──\n`);

  const data = await af<{
    product: {
      title: string;
      media: { nodes: { id: string; status?: string }[] };
      variants: { nodes: { id: string; image: { url: string } | null }[] };
    };
  }>(/* GraphQL */ `
    query($id: ID!) {
      product(id: $id) {
        title
        media(first: 5) { nodes { ... on MediaImage { id status } } }
        variants(first: 100) { nodes { id image { url } } }
      }
    }
  `, { id: PRODUCT_ID });

  const mediaId = data.product.media.nodes[0]?.id;
  if (!mediaId) throw new Error('No product media found — run set-product-image.mts first');
  const variants = data.product.variants.nodes;
  const needing = variants.filter((v) => !v.image); // skip any that already have an image
  console.log(`  ${data.product.title}: ${variants.length} variants, ${needing.length} without an image`);
  console.log(`  media: ${mediaId}`);
  if (needing.length === 0) { console.log('  nothing to do.\n'); return; }

  const res = await af<{
    productVariantAppendMedia: { userErrors: { field: string[]; message: string }[]; productVariants: { id: string }[] };
  }>(/* GraphQL */ `
    mutation($productId: ID!, $variantMedia: [ProductVariantAppendMediaInput!]!) {
      productVariantAppendMedia(productId: $productId, variantMedia: $variantMedia) {
        productVariants { id }
        userErrors { field message }
      }
    }
  `, {
    productId: PRODUCT_ID,
    variantMedia: needing.map((v) => ({ variantId: v.id, mediaIds: [mediaId] })),
  });
  const errs = res.productVariantAppendMedia.userErrors;
  if (errs.length) throw new Error(`productVariantAppendMedia: ${errs.map((e) => e.message).join(', ')}`);
  console.log(`  ✓ attached media to ${res.productVariantAppendMedia.productVariants.length} variants\n`);
}
main().catch((e) => { console.error(e); process.exit(1); });
