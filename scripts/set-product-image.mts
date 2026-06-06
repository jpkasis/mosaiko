/**
 * Set the branded order thumbnail (.brand-order-thumb.png) as the product image
 * on BOTH "Imanes Personalizados" products (v2 + legacy RESPALDO) so every order
 * card — Shop customer account + Shopify admin — shows a Mosaiko tile instead of
 * a gray placeholder. Both products have 0 media today, so this image becomes
 * the featured image. Shopify-side only; the headless storefront is unaffected.
 *
 * Flow per product: stagedUploadsCreate(IMAGE) → POST file to staged target →
 * productCreateMedia(originalSource) → poll media until READY.
 *
 * Run: npx tsx --env-file=.env.local scripts/set-product-image.mts
 */
import { readFile } from 'node:fs/promises';

const API_VERSION = process.env.SHOPIFY_API_VERSION || '2026-04';
const FILE = '.brand-order-thumb.png';
const FILENAME = 'mosaiko-order-thumb.png';
const PRODUCTS = [
  { id: 'gid://shopify/Product/9300378681582', label: 'v2 (imanes-personalizados-v2)' },
  { id: 'gid://shopify/Product/9281652490478', label: 'legacy RESPALDO (imanes-personalizados)' },
];

function mustEnv(key: string): string {
  const v = process.env[key];
  if (!v || v === 'placeholder') {
    console.error(`✗ Missing env: ${key}`);
    process.exit(1);
  }
  return v;
}
const STORE_DOMAIN = mustEnv('NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN');

async function getAdminToken(): Promise<string> {
  const staticToken = process.env.SHOPIFY_ADMIN_API_TOKEN;
  if (staticToken && staticToken !== 'placeholder') return staticToken;
  const res = await fetch(`https://${STORE_DOMAIN}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: mustEnv('SHOPIFY_CLIENT_ID'),
      client_secret: mustEnv('SHOPIFY_CLIENT_SECRET'),
    }).toString(),
  });
  if (!res.ok) {
    console.error(`✗ token mint HTTP ${res.status}: ${await res.text()}`);
    process.exit(1);
  }
  return ((await res.json()) as { access_token: string }).access_token;
}

let TOKEN = '';
async function adminFetch<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(`https://${STORE_DOMAIN}/admin/api/${API_VERSION}/graphql.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': TOKEN },
    body: JSON.stringify({ query, variables }),
  });
  const json = (await res.json()) as { data?: T; errors?: Array<{ message: string }> };
  if (json.errors?.length) throw new Error(json.errors.map((e) => e.message).join('\n'));
  if (!json.data) throw new Error('No data');
  return json.data;
}

type StagedTarget = { url: string; resourceUrl: string; parameters: { name: string; value: string }[] };

async function stageUpload(size: number): Promise<StagedTarget> {
  const data = await adminFetch<{
    stagedUploadsCreate: { stagedTargets: StagedTarget[]; userErrors: { field: string[]; message: string }[] };
  }>(
    /* GraphQL */ `
      mutation Stage($input: [StagedUploadInput!]!) {
        stagedUploadsCreate(input: $input) {
          stagedTargets { url resourceUrl parameters { name value } }
          userErrors { field message }
        }
      }
    `,
    {
      input: [
        {
          filename: FILENAME,
          mimeType: 'image/png',
          resource: 'IMAGE',
          httpMethod: 'POST',
          fileSize: String(size),
        },
      ],
    },
  );
  const errs = data.stagedUploadsCreate.userErrors;
  if (errs.length) throw new Error(`stagedUploadsCreate: ${errs.map((e) => e.message).join(', ')}`);
  return data.stagedUploadsCreate.stagedTargets[0];
}

async function postToStaged(target: StagedTarget, buf: Buffer): Promise<void> {
  const form = new FormData();
  for (const p of target.parameters) form.append(p.name, p.value);
  // Wrap in Uint8Array — a Node Buffer isn't a valid DOM BlobPart under TS lib.
  form.append('file', new Blob([new Uint8Array(buf)], { type: 'image/png' }), FILENAME);
  const res = await fetch(target.url, { method: 'POST', body: form });
  if (!(res.status === 201 || res.status === 204 || res.ok)) {
    throw new Error(`staged upload POST HTTP ${res.status}: ${await res.text()}`);
  }
}

async function createMedia(productId: string, resourceUrl: string): Promise<string> {
  const data = await adminFetch<{
    productCreateMedia: {
      media: { id: string; status: string }[];
      mediaUserErrors: { field: string[]; message: string }[];
    };
  }>(
    /* GraphQL */ `
      mutation AddMedia($productId: ID!, $media: [CreateMediaInput!]!) {
        productCreateMedia(productId: $productId, media: $media) {
          media { ... on MediaImage { id status } }
          mediaUserErrors { field message }
        }
      }
    `,
    {
      productId,
      media: [{ originalSource: resourceUrl, alt: 'Mosaiko', mediaContentType: 'IMAGE' }],
    },
  );
  const errs = data.productCreateMedia.mediaUserErrors;
  if (errs.length) throw new Error(`productCreateMedia: ${errs.map((e) => e.message).join(', ')}`);
  return data.productCreateMedia.media[0]?.id ?? '';
}

async function pollReady(productId: string): Promise<string> {
  for (let i = 0; i < 20; i++) {
    const data = await adminFetch<{
      product: { featuredImage: { url: string } | null; media: { nodes: { status?: string }[] } };
    }>(
      /* GraphQL */ `
        query($id: ID!) {
          product(id: $id) {
            featuredImage { url }
            media(first: 3) { nodes { ... on MediaImage { status } } }
          }
        }
      `,
      { id: productId },
    );
    const statuses = data.product.media.nodes.map((n) => n.status).filter(Boolean);
    if (statuses.includes('READY') && data.product.featuredImage) return data.product.featuredImage.url;
    if (statuses.includes('FAILED')) throw new Error('media processing FAILED');
    await new Promise((r) => setTimeout(r, 1500));
  }
  return '(still processing — check again shortly)';
}

async function main() {
  TOKEN = await getAdminToken();
  const buf = await readFile(FILE);
  console.log(`\n── Set product image → ${STORE_DOMAIN} (API ${API_VERSION}) ──`);
  console.log(`   file: ${FILE} (${(buf.length / 1024).toFixed(0)} KB)\n`);

  for (const p of PRODUCTS) {
    process.stdout.write(`• ${p.label}\n`);
    const target = await stageUpload(buf.length);
    await postToStaged(target, buf);
    const mediaId = await createMedia(p.id, target.resourceUrl);
    process.stdout.write(`    media ${mediaId} created — waiting for READY…\n`);
    const url = await pollReady(p.id);
    process.stdout.write(`    ✓ featuredImage = ${url}\n`);
  }
  console.log('\nDone. Order cards (Shop account + Shopify admin) now show the Mosaiko tile.\n');
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
