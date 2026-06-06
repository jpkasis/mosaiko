/**
 * Phase 8 step B5 — point the ORDERS_PAID webhook at the new domain WITHOUT
 * duplicating subscriptions (subscribe-webhook.mts creates a NEW one every run;
 * this UPDATES the existing one so exactly ONE remains — Codex correction).
 *
 * DRY RUN by default (prints the plan, changes nothing). Pass `--apply` to act.
 * Target callback: WEBHOOK_CALLBACK_URL env, else https://mosaiko.mx/api/webhooks/shopify.
 *
 * Run (preview):  npx tsx --env-file=.env.local scripts/swap-webhook-callback.mts
 * Run (execute):  npx tsx --env-file=.env.local scripts/swap-webhook-callback.mts --apply
 */
const API_VERSION = process.env.SHOPIFY_API_VERSION || '2026-04';
const TOPIC = 'ORDERS_PAID';
const NEW_CALLBACK = process.env.WEBHOOK_CALLBACK_URL || 'https://mosaiko.mx/api/webhooks/shopify';
const APPLY = process.argv.includes('--apply');

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
type UserError = { field?: string[] | null; message: string };
async function admin<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(`https://${STORE_DOMAIN}/admin/api/${API_VERSION}/graphql.json`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': TOKEN },
    body: JSON.stringify({ query, variables }),
  });
  const json = (await res.json()) as { data?: T; errors?: { message: string }[] };
  if (json.errors?.length) throw new Error(json.errors.map((e) => e.message).join('\n'));
  if (!json.data) throw new Error('No data');
  return json.data;
}
function assertNoUserErrors(errs: UserError[] | undefined, label: string) {
  if (errs && errs.length) throw new Error(`${label}: ${errs.map((e) => e.message).join(', ')}`);
}

type Sub = { id: string; format: string; endpoint: { callbackUrl?: string } };

async function listSubs(): Promise<Sub[]> {
  // Paginate ALL ORDERS_PAID subscriptions so the "exactly one" guarantee holds
  // store-wide, not just the first page (Codex audit).
  const out: Sub[] = [];
  let after: string | null = null;
  for (;;) {
    const d: {
      webhookSubscriptions: { nodes: Sub[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } };
    } = await admin(/* GraphQL */ `
      query($after: String) {
        webhookSubscriptions(first: 100, after: $after, topics: [${TOPIC}]) {
          nodes { id format endpoint { __typename ... on WebhookHttpEndpoint { callbackUrl } } }
          pageInfo { hasNextPage endCursor }
        }
      }
    `, { after });
    out.push(...d.webhookSubscriptions.nodes);
    if (!d.webhookSubscriptions.pageInfo.hasNextPage) break;
    after = d.webhookSubscriptions.pageInfo.endCursor;
  }
  return out;
}

async function main() {
  TOKEN = await getAdminToken();
  console.log(`\n── Webhook callback swap → ${STORE_DOMAIN} ──`);
  console.log(`   topic=${TOPIC}  target=${NEW_CALLBACK}  mode=${APPLY ? 'APPLY' : 'DRY RUN'}\n`);

  const subs = await listSubs();
  console.log(`Found ${subs.length} ${TOPIC} subscription(s):`);
  for (const s of subs) console.log(`   • ${s.endpoint?.callbackUrl ?? '(non-HTTP)'}  ${s.id}`);

  // Keep at most one: update the first to the new callback, delete the rest.
  const [keep, ...extras] = subs;

  if (!keep) {
    console.log(`\nPLAN: create a new ${TOPIC} subscription → ${NEW_CALLBACK}`);
    if (APPLY) {
      const d = await admin<{ webhookSubscriptionCreate: { webhookSubscription: { id: string }; userErrors: UserError[] } }>(/* GraphQL */ `
        mutation Create($topic: WebhookSubscriptionTopic!, $sub: WebhookSubscriptionInput!) {
          webhookSubscriptionCreate(topic: $topic, webhookSubscription: $sub) {
            webhookSubscription { id } userErrors { field message }
          }
        }`, { topic: TOPIC, sub: { callbackUrl: NEW_CALLBACK, format: 'JSON' } });
      assertNoUserErrors(d.webhookSubscriptionCreate.userErrors, 'create');
      console.log(`   ✓ created ${d.webhookSubscriptionCreate.webhookSubscription.id}`);
    }
  } else {
    const current = keep.endpoint?.callbackUrl;
    // Update if the URL OR the delivery format is wrong — the route is JSON-only,
    // so an XML subscription pointed at the right URL is still broken (Codex audit).
    const needsUpdate = current !== NEW_CALLBACK || keep.format !== 'JSON';
    if (!needsUpdate) console.log(`\nPLAN: keep ${keep.id} (already → ${NEW_CALLBACK}, JSON)`);
    else {
      console.log(`\nPLAN: update ${keep.id}  ${current} (${keep.format}) → ${NEW_CALLBACK} (JSON)`);
      if (APPLY) {
        const d = await admin<{ webhookSubscriptionUpdate: { userErrors: UserError[] } }>(/* GraphQL */ `
          mutation Upd($id: ID!, $sub: WebhookSubscriptionInput!) {
            webhookSubscriptionUpdate(id: $id, webhookSubscription: $sub) { userErrors { field message } }
          }`, { id: keep.id, sub: { callbackUrl: NEW_CALLBACK, format: 'JSON' } });
        assertNoUserErrors(d.webhookSubscriptionUpdate.userErrors, 'update');
        console.log(`   ✓ updated`);
      }
    }
    for (const ex of extras) {
      console.log(`PLAN: delete duplicate ${ex.id} (${ex.endpoint?.callbackUrl})`);
      if (APPLY) {
        const d = await admin<{ webhookSubscriptionDelete: { userErrors: UserError[] } }>(/* GraphQL */ `
          mutation Del($id: ID!) { webhookSubscriptionDelete(id: $id) { userErrors { field message } } }`, { id: ex.id });
        assertNoUserErrors(d.webhookSubscriptionDelete.userErrors, 'delete');
        console.log(`   ✓ deleted`);
      }
    }
  }

  if (APPLY) {
    const after = await listSubs();
    console.log(`\nAfter: ${after.length} ${TOPIC} subscription(s):`);
    for (const s of after) console.log(`   • ${s.endpoint?.callbackUrl ?? '(non-HTTP)'}  ${s.id}`);
    if (after.length !== 1 || after[0].endpoint?.callbackUrl !== NEW_CALLBACK || after[0].format !== 'JSON') {
      console.error('✗ Expected exactly one JSON subscription at the new callback.'); process.exit(1);
    }
    console.log('   ✓ exactly one, JSON, pointing at the new domain.');
  } else {
    console.log('\n(DRY RUN — nothing changed. Re-run with --apply to execute.)');
  }
  console.log('');
}
main().catch((e) => { console.error(e); process.exit(1); });
