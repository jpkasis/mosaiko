/**
 * Live smoke test for Shopify integration.
 *
 * Runs four checks against the real Shopify store to validate the wiring
 * before committing to the storage refactor (Phase 2 in the linking plan):
 *
 *   1. Storefront API:   product/products query reaches the store
 *   2. Admin API:        graphql endpoint returns 200 + matching shop info
 *   3. stagedUploadsCreate: returns a usable staged target URL
 *   4. fileCreate:       creates a file from staged target, polls fileStatus
 *                        until READY, asserts the cdn.shopify.com URL is reachable
 *
 * Usage (Node 22+ with built-in .env loader):
 *   node --env-file=.env.local --experimental-strip-types scripts/smoke-shopify.mts
 *
 * Or with tsx:
 *   npx tsx --env-file=.env.local scripts/smoke-shopify.mts
 *
 * Required env (in .env.local):
 *   - NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN
 *   - NEXT_PUBLIC_SHOPIFY_STOREFRONT_TOKEN
 *   - SHOPIFY_CLIENT_ID + SHOPIFY_CLIENT_SECRET   (preferred; new Dev Dashboard)
 *     OR SHOPIFY_ADMIN_API_TOKEN                  (legacy; transitional)
 *
 * Exit codes: 0 = all green, 1 = any check failed.
 */

const API_VERSION = '2026-04';

const STORE_DOMAIN = mustEnv('NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN');
const STOREFRONT_TOKEN = mustEnv('NEXT_PUBLIC_SHOPIFY_STOREFRONT_TOKEN');

function mustEnv(key: string): string {
  const v = process.env[key];
  if (!v || v === 'placeholder') {
    console.error(`✗ Missing or placeholder env: ${key}`);
    process.exit(1);
  }
  return v;
}

async function getAdminToken(): Promise<string> {
  const staticToken = process.env.SHOPIFY_ADMIN_API_TOKEN;
  if (staticToken && staticToken !== 'placeholder') return staticToken;
  const clientId = process.env.SHOPIFY_CLIENT_ID;
  const clientSecret = process.env.SHOPIFY_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    console.error(
      '✗ Need either SHOPIFY_ADMIN_API_TOKEN or (SHOPIFY_CLIENT_ID + SHOPIFY_CLIENT_SECRET).',
    );
    process.exit(1);
  }
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
  });
  const res = await fetch(`https://${STORE_DOMAIN}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) {
    console.error(`✗ Admin token mint HTTP ${res.status}: ${await res.text()}`);
    process.exit(1);
  }
  const data = (await res.json()) as { access_token: string };
  return data.access_token;
}

let ADMIN_TOKEN = '';

const log = {
  info: (msg: string) => console.log(`  ${msg}`),
  ok: (msg: string) => console.log(`✓ ${msg}`),
  fail: (msg: string) => console.error(`✗ ${msg}`),
  section: (msg: string) => console.log(`\n── ${msg} ──`),
};

async function storefrontFetch<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
  const res = await fetch(`https://${STORE_DOMAIN}/api/${API_VERSION}/graphql.json`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Storefront-Access-Token': STOREFRONT_TOKEN,
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`Storefront HTTP ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as { data?: T; errors?: Array<{ message: string }> };
  if (json.errors?.length) throw new Error(`Storefront GraphQL: ${json.errors.map((e) => e.message).join('; ')}`);
  if (!json.data) throw new Error('Storefront: empty data');
  return json.data;
}

async function adminFetch<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
  const res = await fetch(`https://${STORE_DOMAIN}/admin/api/${API_VERSION}/graphql.json`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': ADMIN_TOKEN,
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`Admin HTTP ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as { data?: T; errors?: Array<{ message: string }> };
  if (json.errors?.length) throw new Error(`Admin GraphQL: ${json.errors.map((e) => e.message).join('; ')}`);
  if (!json.data) throw new Error('Admin: empty data');
  return json.data;
}

// ─── Check 1: Storefront API ────────────────────────────────────────────────

async function checkStorefront(): Promise<boolean> {
  log.section('1. Storefront API — products query');
  try {
    type Resp = { products: { edges: Array<{ node: { id: string; title: string; variants: { edges: Array<{ node: { id: string; title: string; price: { amount: string; currencyCode: string } } }> } } }> } };
    const data = await storefrontFetch<Resp>(`
      query {
        products(first: 5) {
          edges {
            node {
              id
              title
              variants(first: 10) {
                edges { node { id title price { amount currencyCode } } }
              }
            }
          }
        }
      }
    `);
    const products = data.products.edges;
    if (products.length === 0) {
      log.fail('No products found in store. Create "Imanes Personalizados" with 4 variants first (Phase 1.1).');
      return false;
    }
    log.ok(`Storefront responds. Found ${products.length} product(s):`);
    for (const { node } of products) {
      log.info(`- ${node.title} [${node.id}]`);
      for (const v of node.variants.edges) {
        log.info(`    · ${v.node.title}: ${v.node.price.amount} ${v.node.price.currencyCode}  (${v.node.id})`);
      }
    }
    return true;
  } catch (e) {
    log.fail(`Storefront query failed: ${(e as Error).message}`);
    return false;
  }
}

// ─── Check 2: Admin API ─────────────────────────────────────────────────────

async function checkAdmin(): Promise<boolean> {
  log.section('2. Admin API — shop query');
  try {
    type Resp = { shop: { name: string; primaryDomain: { url: string }; plan: { displayName: string } } };
    const data = await adminFetch<Resp>(`
      query {
        shop {
          name
          primaryDomain { url }
          plan { displayName }
        }
      }
    `);
    log.ok(`Admin responds.`);
    log.info(`- Shop:  ${data.shop.name}`);
    log.info(`- URL:   ${data.shop.primaryDomain.url}`);
    log.info(`- Plan:  ${data.shop.plan.displayName}`);
    return true;
  } catch (e) {
    log.fail(`Admin query failed: ${(e as Error).message}`);
    return false;
  }
}

// ─── Check 3: stagedUploadsCreate ──────────────────────────────────────────

async function checkStagedUpload(): Promise<{ stagedTarget: { url: string; resourceUrl: string; parameters: Array<{ name: string; value: string }> }; pngBytes: Uint8Array } | null> {
  log.section('3. stagedUploadsCreate — get staged target');
  // 1×1 transparent PNG (smallest valid PNG)
  const pngBytes = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));
  try {
    type Resp = {
      stagedUploadsCreate: {
        stagedTargets: Array<{
          url: string;
          resourceUrl: string;
          parameters: Array<{ name: string; value: string }>;
        }>;
        userErrors: Array<{ field: string[]; message: string }>;
      };
    };
    const data = await adminFetch<Resp>(`
      mutation StagedUploadsCreate($input: [StagedUploadInput!]!) {
        stagedUploadsCreate(input: $input) {
          stagedTargets {
            url
            resourceUrl
            parameters { name value }
          }
          userErrors { field message }
        }
      }
    `, {
      input: [{
        filename: 'mosaiko-smoke-test.png',
        mimeType: 'image/png',
        resource: 'FILE',
        fileSize: String(pngBytes.byteLength),
        httpMethod: 'POST',
      }],
    });
    if (data.stagedUploadsCreate.userErrors.length > 0) {
      log.fail(`stagedUploadsCreate userErrors: ${JSON.stringify(data.stagedUploadsCreate.userErrors)}`);
      return null;
    }
    const target = data.stagedUploadsCreate.stagedTargets[0];
    log.ok(`Got staged target.`);
    log.info(`- url:         ${target.url}`);
    log.info(`- resourceUrl: ${target.resourceUrl}`);
    return { stagedTarget: target, pngBytes };
  } catch (e) {
    log.fail(`stagedUploadsCreate failed: ${(e as Error).message}`);
    return null;
  }
}

// ─── Check 4: fileCreate + fileStatus polling ──────────────────────────────

async function checkFileCreate(stagedTarget: { url: string; resourceUrl: string; parameters: Array<{ name: string; value: string }> }, pngBytes: Uint8Array): Promise<boolean> {
  log.section('4. fileCreate — upload to staged URL, then create File, then poll status');

  // Step A: POST the bytes to the staged URL using multipart/form-data.
  try {
    const form = new FormData();
    for (const p of stagedTarget.parameters) form.append(p.name, p.value);
    form.append('file', new Blob([pngBytes as BlobPart], { type: 'image/png' }), 'mosaiko-smoke-test.png');
    const uploadRes = await fetch(stagedTarget.url, { method: 'POST', body: form });
    if (!uploadRes.ok) {
      log.fail(`Staged upload POST failed: HTTP ${uploadRes.status} ${await uploadRes.text()}`);
      return false;
    }
    log.ok(`Bytes posted to staged target.`);
  } catch (e) {
    log.fail(`Staged upload POST threw: ${(e as Error).message}`);
    return false;
  }

  // Step B: fileCreate to register the file
  let fileId: string;
  try {
    type Resp = {
      fileCreate: {
        files: Array<{ id: string; fileStatus: string; alt: string | null }>;
        userErrors: Array<{ field: string[]; message: string }>;
      };
    };
    const data = await adminFetch<Resp>(`
      mutation FileCreate($files: [FileCreateInput!]!) {
        fileCreate(files: $files) {
          files { id fileStatus alt }
          userErrors { field message }
        }
      }
    `, {
      files: [{ originalSource: stagedTarget.resourceUrl, contentType: 'IMAGE', alt: 'Mosaiko smoke test' }],
    });
    if (data.fileCreate.userErrors.length > 0) {
      log.fail(`fileCreate userErrors: ${JSON.stringify(data.fileCreate.userErrors)}`);
      return false;
    }
    fileId = data.fileCreate.files[0].id;
    log.ok(`fileCreate returned id ${fileId} (status: ${data.fileCreate.files[0].fileStatus})`);
  } catch (e) {
    log.fail(`fileCreate failed: ${(e as Error).message}`);
    return false;
  }

  // Step C: poll fileStatus until READY or timeout
  const start = Date.now();
  const timeoutMs = 30_000;
  let cdnUrl: string | null = null;

  while (Date.now() - start < timeoutMs) {
    try {
      type Resp = {
        node: { id: string; fileStatus: string; image?: { url: string }; preview?: { image?: { url: string } } } | null;
      };
      const data = await adminFetch<Resp>(`
        query Node($id: ID!) {
          node(id: $id) {
            ... on MediaImage {
              id
              fileStatus
              image { url }
              preview { image { url } }
            }
          }
        }
      `, { id: fileId });
      const node = data.node;
      if (!node) {
        log.fail(`fileStatus poll: node not found`);
        return false;
      }
      if (node.fileStatus === 'READY') {
        cdnUrl = node.image?.url ?? node.preview?.image?.url ?? null;
        if (!cdnUrl) {
          log.fail(`READY but no image.url returned. Response: ${JSON.stringify(node)}`);
          return false;
        }
        log.ok(`File READY in ${Date.now() - start}ms.  URL: ${cdnUrl}`);
        break;
      }
      if (node.fileStatus === 'FAILED') {
        log.fail(`fileStatus FAILED. Response: ${JSON.stringify(node)}`);
        return false;
      }
      log.info(`status=${node.fileStatus} (waiting...)`);
      await new Promise((r) => setTimeout(r, 1000));
    } catch (e) {
      log.fail(`fileStatus poll failed: ${(e as Error).message}`);
      return false;
    }
  }

  if (!cdnUrl) {
    log.fail(`fileStatus did not reach READY within ${timeoutMs}ms`);
    return false;
  }

  // Step D: HEAD the CDN URL to confirm reachable
  try {
    const headRes = await fetch(cdnUrl, { method: 'HEAD' });
    if (!headRes.ok) {
      log.fail(`HEAD ${cdnUrl} → HTTP ${headRes.status}`);
      return false;
    }
    log.ok(`CDN URL is reachable (HEAD 200, content-type ${headRes.headers.get('content-type')})`);
  } catch (e) {
    log.fail(`HEAD failed: ${(e as Error).message}`);
    return false;
  }

  return true;
}

// ─── main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log('Mosaiko Shopify smoke test');
  console.log(`Store: ${STORE_DOMAIN}  ·  API ${API_VERSION}`);
  ADMIN_TOKEN = await getAdminToken();

  const results: Record<string, boolean> = {};

  results.storefront = await checkStorefront();
  results.admin = await checkAdmin();

  const staged = await checkStagedUpload();
  if (!staged) {
    results.staged = false;
    results.fileCreate = false;
  } else {
    results.staged = true;
    results.fileCreate = await checkFileCreate(staged.stagedTarget, staged.pngBytes);
  }

  console.log('\n── Summary ──');
  let allGreen = true;
  for (const [k, v] of Object.entries(results)) {
    console.log(`${v ? '✓' : '✗'} ${k}`);
    if (!v) allGreen = false;
  }

  if (!allGreen) {
    console.error('\nOne or more checks failed. Phase 2 refactor is GATED until all green.');
    process.exit(1);
  }
  console.log('\nAll checks green. Phase 2 refactor is unlocked.');
}

void main();
