/**
 * PR-B/PR-C — migration for the v2 pricing product on the LIVE Shopify store.
 * One product ("Imanes Personalizados") with two options (Categoría × Tamaño)
 * and one variant per valid (category, size). After this runs you must one-click
 * "Make available" on the Online Store sales channel in Shopify admin — that
 * publish is the cutover trigger (the storefront reads the product by handle
 * once it's published; until then it falls back to the legacy size-based
 * prices, so nothing breaks).
 *
 * Idempotent + UPSERT (PR-C): productSet is declarative and matches variants by
 * their option-value pair, so re-running RECONCILES the product to the full set
 * of `PRICING_COMBOS`. Existing variants keep their CURRENT live prices (read
 * back first), and any newly-added combo — e.g. the single-tile `mosaicos:1`
 * introduced in PR-C — is created. mosaicos:1 is priced from the LIVE 3-piece
 * (singleTilePriceFrom) so it lands at ⅓ of whatever the client has set, not a
 * stale seed. The old size-only variants live on a different product and are
 * untouched (order history references them).
 *
 * Run: `npx tsx scripts/migrate-pricing.mts`
 */
import {
  PRICING_PRODUCT_HANDLE,
  CATEGORY_OPTION_NAME,
  SIZE_OPTION_NAME,
  PRICING_COMBOS,
  SEED_PRICE_MATRIX,
  categoryOptionValue,
  sizeOptionValue,
  categoryFromOptionValue,
  sizeFromOptionValue,
} from '../src/lib/shopify/pricing-options';
import { singleTilePriceFrom } from '../src/lib/grid-config';
import type { CategoryType } from '../src/lib/customization-types';
import type { GridSize } from '../src/lib/grid-config';

const API_VERSION = process.env.SHOPIFY_API_VERSION || '2026-04';

function mustEnv(key: string): string {
  const v = process.env[key];
  if (!v || v === 'placeholder') {
    console.error(`✗ Missing or placeholder env: ${key}`);
    process.exit(1);
  }
  return v;
}

const STORE_DOMAIN = mustEnv('NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN');

async function getAdminToken(): Promise<string> {
  const staticToken = process.env.SHOPIFY_ADMIN_API_TOKEN;
  if (staticToken && staticToken !== 'placeholder') return staticToken;
  const clientId = process.env.SHOPIFY_CLIENT_ID;
  const clientSecret = process.env.SHOPIFY_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    console.error('✗ Need SHOPIFY_ADMIN_API_TOKEN or (SHOPIFY_CLIENT_ID + SHOPIFY_CLIENT_SECRET).');
    process.exit(1);
  }
  const res = await fetch(`https://${STORE_DOMAIN}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
    }).toString(),
  });
  if (!res.ok) {
    console.error(`✗ Admin token mint HTTP ${res.status}: ${await res.text()}`);
    process.exit(1);
  }
  return ((await res.json()) as { access_token: string }).access_token;
}

let ADMIN_TOKEN = '';

async function adminFetch<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(`https://${STORE_DOMAIN}/admin/api/${API_VERSION}/graphql.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': ADMIN_TOKEN },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as { data?: T; errors?: Array<{ message: string }> };
  if (json.errors?.length) throw new Error(json.errors.map((e) => e.message).join('\n'));
  if (!json.data) throw new Error('No data in response');
  return json.data;
}

const EXISTS_QUERY = /* GraphQL */ `
  query Exists($q: String!) {
    products(first: 1, query: $q) {
      nodes {
        id
        handle
        variants(first: 100) {
          nodes {
            selectedOptions { name value }
            price
          }
        }
      }
    }
  }
`;

const PRODUCT_SET_MUTATION = /* GraphQL */ `
  mutation CreatePricing($input: ProductSetInput!) {
    productSet(input: $input) {
      product { id handle status options { name optionValues { name } } variants(first: 100) { nodes { id title price } } }
      userErrors { field message }
    }
  }
`;

async function main(): Promise<void> {
  ADMIN_TOKEN = await getAdminToken();
  console.log(`\n── Pricing migration → ${STORE_DOMAIN} (API ${API_VERSION}) ──`);

  // Read the existing pricing product (if any). productSet is declarative and
  // matches variants by option-value pair, so we reconcile to the full combo
  // set while PRESERVING each existing variant's current live price (read back
  // here) — only genuinely new combos (PR-C's mosaicos:1) get added.
  const existing = await adminFetch<{
    products: {
      nodes: {
        id: string;
        handle: string;
        variants: { nodes: { selectedOptions: { name: string; value: string }[]; price: string }[] };
      }[];
    };
  }>(EXISTS_QUERY, { q: `handle:${PRICING_PRODUCT_HANDLE}` });
  const existingProduct = existing.products.nodes[0] ?? null;

  const currentPrice = new Map<string, number>();
  if (existingProduct) {
    for (const v of existingProduct.variants.nodes) {
      const catVal = v.selectedOptions.find((o) => o.name === CATEGORY_OPTION_NAME)?.value;
      const sizeVal = v.selectedOptions.find((o) => o.name === SIZE_OPTION_NAME)?.value;
      const category = catVal ? categoryFromOptionValue(catVal) : null;
      const size = sizeVal ? sizeFromOptionValue(sizeVal) : null;
      const price = Number(v.price);
      if (category && size != null && Number.isFinite(price)) {
        currentPrice.set(`${category}:${size}`, price);
      }
    }
    console.log(
      `◇ Product exists (${existingProduct.id}); preserving ${currentPrice.size} live prices, adding any new combos.`,
    );
  } else {
    console.log('◇ Product does not exist; creating fresh.');
  }

  // The single tile derives from the LIVE 3-piece; every other combo keeps its
  // current live price, falling back to the seed for a brand-new combo.
  function priceForCombo(category: CategoryType, gridSize: GridSize): number {
    if (category === 'mosaicos' && gridSize === 1) {
      const three = currentPrice.get('mosaicos:3') ?? SEED_PRICE_MATRIX.mosaicos[3];
      if (three == null) {
        console.error('✗ No 3-piece price to derive the single tile from; aborting.');
        process.exit(1);
      }
      return singleTilePriceFrom(three);
    }
    const live = currentPrice.get(`${category}:${gridSize}`);
    if (live != null) return live;
    const seed = SEED_PRICE_MATRIX[category]?.[gridSize];
    if (seed == null) {
      console.error(`✗ No seed price for ${category} ${gridSize}; aborting.`);
      process.exit(1);
    }
    return seed;
  }

  // Build distinct option values + one variant per (category, size).
  const categoryValues = new Set<string>();
  const sizeValues = new Set<string>();
  const variants: Array<{ optionValues: Array<{ optionName: string; name: string }>; price: string }> = [];

  for (const { category, gridSize } of PRICING_COMBOS) {
    const price = priceForCombo(category as CategoryType, gridSize);
    const catVal = categoryOptionValue(category);
    const sizeVal = sizeOptionValue(gridSize);
    categoryValues.add(catVal);
    sizeValues.add(sizeVal);
    variants.push({
      optionValues: [
        { optionName: CATEGORY_OPTION_NAME, name: catVal },
        { optionName: SIZE_OPTION_NAME, name: sizeVal },
      ],
      price: price.toFixed(2),
    });
  }

  const input: Record<string, unknown> = {
    title: 'Imanes Personalizados',
    handle: PRICING_PRODUCT_HANDLE,
    status: 'ACTIVE',
    productOptions: [
      { name: CATEGORY_OPTION_NAME, values: [...categoryValues].map((name) => ({ name })) },
      { name: SIZE_OPTION_NAME, values: [...sizeValues].map((name) => ({ name })) },
    ],
    variants,
  };
  if (existingProduct) input.id = existingProduct.id;

  console.log(`  ${existingProduct ? 'Reconciling' : 'Creating'} product with ${variants.length} variants…`);
  const res = await adminFetch<{
    productSet: {
      product: { id: string; handle: string; variants: { nodes: { title: string; price: string }[] } } | null;
      userErrors: Array<{ field?: string[]; message: string }>;
    };
  }>(PRODUCT_SET_MUTATION, { input });

  if (res.productSet.userErrors.length) {
    console.error('✗ productSet userErrors:');
    for (const e of res.productSet.userErrors) console.error(`   ${e.field?.join('.') ?? '<top>'}: ${e.message}`);
    process.exit(1);
  }

  const product = res.productSet.product!;
  console.log(`✓ ${existingProduct ? 'Updated' : 'Created'} ${product.handle} (${product.id})`);
  for (const v of product.variants.nodes) console.log(`   • ${v.title} → $${v.price}`);
  if (existingProduct) {
    console.log(
      `\n✓ Reconciled. If the product is already published to the Online Store,\n` +
        `  the new single-tile (1 pieza) variant is live now. If it was never\n` +
        `  published, do the one-click "Make available" step below.`,
    );
  }
  console.log(
    `\n⚠ PUBLISH (one click, only if not already done): in Shopify admin open the\n` +
      `  product and "Make available" on the Online Store / Storefront sales\n` +
      `  channel. The storefront + checkout switch to these per-category prices\n` +
      `  automatically once it's published (reads by handle). No env change needed.`,
  );
}

main().catch((err) => {
  console.error('✗ Migration failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
