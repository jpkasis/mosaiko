/**
 * READ-ONLY diagnostic: why does the Shop customer-account order history show
 * gray placeholder thumbnails? Query the recent orders' line items and the
 * pricing/legacy products to see whether any product image is set.
 *
 * Run: npx tsx --env-file=.env.local scripts/check-order-images.mts
 */
const API_VERSION = process.env.SHOPIFY_API_VERSION || '2026-04';

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
async function adminFetch<T>(query: string): Promise<T> {
  const res = await fetch(`https://${STORE_DOMAIN}/admin/api/${API_VERSION}/graphql.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': TOKEN },
    body: JSON.stringify({ query }),
  });
  const json = (await res.json()) as { data?: T; errors?: Array<{ message: string }> };
  if (json.errors?.length) throw new Error(json.errors.map((e) => e.message).join('\n'));
  if (!json.data) throw new Error('No data');
  return json.data;
}

type ProdNode = {
  id: string;
  title: string;
  handle: string;
  status: string;
  featuredImage: { url: string } | null;
  media: { nodes: { id: string }[] };
};
type OrderNode = {
  name: string;
  createdAt: string;
  lineItems: {
    nodes: {
      title: string;
      image: { url: string } | null;
      product: { id: string; title: string; featuredImage: { url: string } | null } | null;
    }[];
  };
};

async function main() {
  TOKEN = await getAdminToken();
  console.log(`\n── Order-image diagnostic → ${STORE_DOMAIN} (API ${API_VERSION}) ──\n`);

  // 1. The two "Imanes Personalizados" products (v2 + legacy): do they have an image?
  const prods = await adminFetch<{ products: { nodes: ProdNode[] } }>(/* GraphQL */ `
    query {
      products(first: 20, query: "title:Imanes*") {
        nodes {
          id title handle status
          featuredImage { url }
          media(first: 1) { nodes { id } }
        }
      }
    }
  `);
  console.log('PRODUCTS named "Imanes…":');
  for (const p of prods.products.nodes) {
    console.log(
      `  • ${p.title}  [${p.handle}]  status=${p.status}\n` +
        `      id=${p.id}\n` +
        `      featuredImage=${p.featuredImage ? p.featuredImage.url : 'NONE'}  mediaCount=${p.media.nodes.length}`,
    );
  }

  // 2. The most recent orders: what image does each line item resolve to?
  try {
    const orders = await adminFetch<{ orders: { nodes: OrderNode[] } }>(/* GraphQL */ `
      query {
        orders(first: 6, sortKey: CREATED_AT, reverse: true) {
          nodes {
            name createdAt
            lineItems(first: 5) {
              nodes {
                title
                image { url }
                product { id title featuredImage { url } }
              }
            }
          }
        }
      }
    `);
    console.log('\nRECENT ORDERS (line-item image resolution):');
    for (const o of orders.orders.nodes) {
      console.log(`  ${o.name}  (${o.createdAt.slice(0, 10)})`);
      for (const li of o.lineItems.nodes) {
        const img = li.image?.url ?? li.product?.featuredImage?.url ?? 'NONE';
        console.log(`     - "${li.title}"  → image=${img === 'NONE' ? 'NONE (placeholder)' : img}`);
      }
    }
  } catch (e) {
    console.log(`\n(orders query failed — likely missing read_orders scope: ${(e as Error).message})`);
  }
  console.log('');
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
