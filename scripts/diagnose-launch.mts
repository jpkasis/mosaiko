/**
 * READ-ONLY pre-launch (Phase 7/8) diagnostic. Reports the live state the
 * launch runbook depends on — makes NO changes:
 *   1. The ORDERS_PAID webhook subscription's callback URL + API version
 *      (must point at the stable production deployment; swap to mosaiko.mx at
 *      the Phase 8 cutover).
 *   2. Which sales channels the pricing products are published to
 *      (needs the `read_publications` Admin scope — if absent, this reports
 *      exactly that so you can add it in the Shopify app's API access settings).
 *   3. The Storefront-API visibility of the v2 product (onlineStoreUrl) — the
 *      signal for the Phase 8 "unpublish from Online Store" step.
 *
 * Run: npx tsx --env-file=.env.local scripts/diagnose-launch.mts
 */
const API_VERSION = process.env.SHOPIFY_API_VERSION || '2026-04';
const V2_HANDLE = process.env.SHOPIFY_PRICING_PRODUCT_HANDLE || 'imanes-personalizados-v2';

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
async function admin<T>(query: string): Promise<{ data?: T; errors?: { message: string }[] }> {
  const res = await fetch(`https://${STORE_DOMAIN}/admin/api/${API_VERSION}/graphql.json`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': TOKEN },
    body: JSON.stringify({ query }),
  });
  return (await res.json()) as { data?: T; errors?: { message: string }[] };
}

async function storefront<T>(query: string): Promise<{ data?: T; errors?: { message: string }[] }> {
  const res = await fetch(`https://${STORE_DOMAIN}/api/${API_VERSION}/graphql.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Storefront-Access-Token': mustEnv('NEXT_PUBLIC_SHOPIFY_STOREFRONT_TOKEN') },
    body: JSON.stringify({ query }),
  });
  return (await res.json()) as { data?: T; errors?: { message: string }[] };
}

async function main() {
  TOKEN = await getAdminToken();
  console.log(`\n── Launch diagnostic (READ-ONLY) → ${STORE_DOMAIN} (API ${API_VERSION}) ──\n`);

  // 1. ORDERS_PAID webhook subscription
  console.log('1) ORDERS_PAID webhook subscription:');
  const wh = await admin<{ webhookSubscriptions: { nodes: { id: string; topic: string; apiVersion: { handle: string }; endpoint: { callbackUrl?: string } }[] } }>(/* GraphQL */ `
    query { webhookSubscriptions(first: 50, topics: [ORDERS_PAID]) { nodes {
      id topic apiVersion { handle }
      endpoint { __typename ... on WebhookHttpEndpoint { callbackUrl } }
    } } }
  `);
  if (wh.errors?.length) console.log(`   ✗ ${wh.errors.map((e) => e.message).join('; ')}`);
  const subs = wh.data?.webhookSubscriptions.nodes ?? [];
  if (subs.length === 0) console.log('   ⚠ NO ORDERS_PAID subscription found');
  for (const s of subs) {
    console.log(`   • ${s.endpoint?.callbackUrl ?? '(non-HTTP endpoint)'}  [api ${s.apiVersion.handle}]  ${s.id}`);
  }

  // 2. Publications (needs read_publications)
  console.log('\n2) Sales channels (publications) — needs read_publications scope:');
  const pubs = await admin<{ publications: { nodes: { name: string }[] } }>(/* GraphQL */ `
    query { publications(first: 25) { nodes { name } } }
  `);
  if (pubs.errors?.length) {
    console.log(`   ✗ ${pubs.errors.map((e) => e.message).join('; ')}`);
    console.log('   → ADD the read_publications (and write_publications for Phase 8) scope to the');
    console.log('     custom app (Shopify admin → Settings → Apps → develop apps → your app →');
    console.log('     Configuration → Admin API access scopes), then re-run.');
  } else {
    for (const p of pubs.data?.publications.nodes ?? []) console.log(`   • ${p.name}`);
    // Resolve the v2 product's Admin GID by handle (don't hardcode it — the
    // handle is env-overridable, so the GID must follow it). Codex final audit.
    const idLookup = await admin<{ products: { nodes: { id: string }[] } }>(/* GraphQL */ `
      query { products(first: 1, query: "handle:${V2_HANDLE}") { nodes { id } } }
    `);
    const v2Id = idLookup.data?.products.nodes[0]?.id;
    if (!v2Id) {
      console.log(`   ⚠ v2 product (handle:${V2_HANDLE}) not found via Admin API`);
    } else {
      const prodPubs = await admin<{ product: { resourcePublicationsV2: { nodes: { isPublished: boolean; publication: { name: string } }[] } } }>(/* GraphQL */ `
        query { product(id: "${v2Id}") { resourcePublicationsV2(first: 25) { nodes { isPublished publication { name } } } } }
      `);
      const channels = prodPubs.data?.product.resourcePublicationsV2.nodes ?? [];
      console.log(`   v2 product (${v2Id}) published on: ${channels.map((c) => c.publication.name).join(', ') || '(query failed)'}`);
    }
  }

  // 3. Storefront visibility of v2 (onlineStoreUrl)
  console.log('\n3) v2 Storefront visibility (drives the Phase 8 Online-Store-unpublish):');
  const sf = await storefront<{ product: { handle: string; onlineStoreUrl: string | null } | null }>(/* GraphQL */ `
    query { product(handle: "${V2_HANDLE}") { handle onlineStoreUrl } }
  `);
  if (sf.errors?.length) console.log(`   ✗ ${sf.errors.map((e) => e.message).join('; ')}`);
  const p = sf.data?.product;
  if (!p) console.log('   ⚠ v2 product NOT resolvable via the Storefront token (would FAIL checkout)');
  else console.log(`   • resolves ✓  onlineStoreUrl=${p.onlineStoreUrl ?? 'null (not on Online Store)'}`);
  console.log('');
}
main().catch((e) => { console.error(e); process.exit(1); });
