/**
 * READ-ONLY diagnostic for two Shop-surface issues:
 *  (1) order-history thumbnails still gray though product.featuredImage is set
 *      → inspect line-item image vs variant image vs product image (snapshot?)
 *  (2) the customer-account "Mosaiko" link points at mosaiko-mx.myshopify.com
 *      → inspect primary domain + which channels the products are published to
 *
 * Run: npx tsx --env-file=.env.local scripts/diagnose-shop-surfaces.mts
 */
const API_VERSION = process.env.SHOPIFY_API_VERSION || '2026-04';
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
async function af<T>(query: string): Promise<T> {
  const res = await fetch(`https://${STORE_DOMAIN}/admin/api/${API_VERSION}/graphql.json`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': TOKEN },
    body: JSON.stringify({ query }),
  });
  const json = (await res.json()) as { data?: T; errors?: Array<{ message: string }> };
  if (json.errors?.length) throw new Error(json.errors.map((e) => e.message).join('\n'));
  if (!json.data) throw new Error('No data');
  return json.data;
}

async function main() {
  TOKEN = await getAdminToken();
  console.log(`\n── Shop-surface diagnostic → ${STORE_DOMAIN} (API ${API_VERSION}) ──\n`);

  // (2a) Primary domain + shop urls
  try {
    const d = await af<{ shop: { name: string; url: string; myshopifyDomain: string; primaryDomain: { url: string; host: string; sslEnabled: boolean } } }>(/* GraphQL */ `
      query { shop { name url myshopifyDomain primaryDomain { url host sslEnabled } } }
    `);
    console.log('SHOP / DOMAIN:');
    console.log(`  name=${d.shop.name}`);
    console.log(`  url=${d.shop.url}`);
    console.log(`  myshopifyDomain=${d.shop.myshopifyDomain}`);
    console.log(`  primaryDomain=${d.shop.primaryDomain.host}  (ssl=${d.shop.primaryDomain.sslEnabled})  url=${d.shop.primaryDomain.url}`);
  } catch (e) { console.log(`  (shop query failed: ${(e as Error).message})`); }

  // (2b) Which channels are the two products published to?
  for (const [label, id] of [
    ['v2', 'gid://shopify/Product/9300378681582'],
    ['legacy RESPALDO', 'gid://shopify/Product/9281652490478'],
  ] as const) {
    try {
      const p = await af<{ product: { title: string; resourcePublicationsV2: { nodes: { isPublished: boolean; publication: { name: string } }[] } } }>(/* GraphQL */ `
        query { product(id: "${id}") {
          title
          resourcePublicationsV2(first: 20) { nodes { isPublished publication { name } } }
        } }
      `);
      const pubs = p.product.resourcePublicationsV2.nodes.map((n) => `${n.publication.name}${n.isPublished ? '' : '(unpub)'}`).join(', ');
      console.log(`\nPRODUCT ${label} published on: ${pubs || 'NONE'}`);
    } catch (e) { console.log(`\nPRODUCT ${label} publications query failed: ${(e as Error).message}`); }
  }

  // (1) Per line-item image breakdown for the 3 most recent orders
  try {
    const o = await af<{ orders: { nodes: { name: string; lineItems: { nodes: { name: string; image: { url: string } | null; variant: { id: string; image: { url: string } | null } | null; product: { featuredImage: { url: string } | null } | null }[] } }[] } }>(/* GraphQL */ `
      query { orders(first: 3, sortKey: CREATED_AT, reverse: true) { nodes {
        name
        lineItems(first: 3) { nodes {
          name
          image { url }
          variant { id image { url } }
          product { featuredImage { url } }
        } }
      } } }
    `);
    console.log('\nORDER LINE-ITEM IMAGE BREAKDOWN (snapshot vs live):');
    for (const ord of o.orders.nodes) {
      console.log(`  ${ord.name}`);
      for (const li of ord.lineItems.nodes) {
        console.log(`     lineItem.image   = ${li.image?.url ? 'SET' : 'null'}`);
        console.log(`     variant.image    = ${li.variant?.image?.url ? 'SET' : 'null'}  (variant ${li.variant?.id ?? 'n/a'})`);
        console.log(`     product.featured = ${li.product?.featuredImage?.url ? 'SET' : 'null'}`);
      }
    }
  } catch (e) { console.log(`\n(orders query failed: ${(e as Error).message})`); }
  console.log('');
}
main().catch((e) => { console.error(e); process.exit(1); });
