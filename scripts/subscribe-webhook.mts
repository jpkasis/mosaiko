import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const API_VERSION = '2026-04';
const TOPIC = 'ORDERS_PAID';
const CALLBACK_URL = 'https://mosaiko.vercel.app/api/webhooks/shopify';
const REQUEST_TIMEOUT_MS = 30_000;

type GraphQLError = { message: string };
type UserError = { field?: string[] | null; message: string };

type WebhookHttpEndpoint = {
  __typename: 'WebhookHttpEndpoint';
  callbackUrl: string;
};

type WebhookSubscription = {
  id: string;
  topic: string;
  format: string;
  endpoint: WebhookHttpEndpoint | { __typename: string };
  apiVersion: { handle: string };
};

function loadEnvLocal(): void {
  const path = resolve(process.cwd(), '.env.local');
  if (!existsSync(path)) return;

  const contents = readFileSync(path, 'utf8');
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;

    const [, key, rawValue] = match;
    if (process.env[key] !== undefined) continue;

    let value = rawValue.trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`Missing ${key}`);
  return value;
}

function getStoreDomain(): string {
  return requireEnv('SHOPIFY_STORE_DOMAIN')
    .replace(/^https?:\/\//, '')
    .replace(/\/+$/, '');
}

function formatUserErrors(userErrors: UserError[]): string {
  return userErrors
    .map((error) => `${error.field?.join('.') || '(root)'}: ${error.message}`)
    .join('; ');
}

function getHttpCallbackUrl(subscription: WebhookSubscription): string {
  if (
    subscription.endpoint.__typename !== 'WebhookHttpEndpoint' ||
    !('callbackUrl' in subscription.endpoint)
  ) {
    throw new Error(`Expected WebhookHttpEndpoint, got ${subscription.endpoint.__typename}`);
  }

  return subscription.endpoint.callbackUrl;
}

async function mintAdminAccessToken(storeDomain: string): Promise<string> {
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: requireEnv('SHOPIFY_CLIENT_ID'),
    client_secret: requireEnv('SHOPIFY_CLIENT_SECRET'),
  });

  const res = await fetchShopify(`https://${storeDomain}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) {
    throw new Error(`Admin token mint HTTP ${res.status}: ${await res.text()}`);
  }

  const data = (await res.json()) as { access_token?: string };
  if (!data.access_token) throw new Error('Admin token mint returned no access_token');
  return data.access_token;
}

async function adminGraphql<TData>(
  storeDomain: string,
  adminToken: string,
  query: string,
  variables?: Record<string, unknown>,
): Promise<TData> {
  const res = await fetchShopify(`https://${storeDomain}/admin/api/${API_VERSION}/graphql.json`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': adminToken,
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) {
    throw new Error(`Admin GraphQL HTTP ${res.status}: ${await res.text()}`);
  }

  const json = (await res.json()) as { data?: TData; errors?: GraphQLError[] };
  if (json.errors?.length) {
    throw new Error(`Admin GraphQL errors: ${json.errors.map((error) => error.message).join('; ')}`);
  }
  if (!json.data) throw new Error('Admin GraphQL returned no data');

  return json.data;
}

async function fetchShopify(input: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function createWebhookSubscription(
  storeDomain: string,
  adminToken: string,
): Promise<WebhookSubscription> {
  const data = await adminGraphql<{
    webhookSubscriptionCreate?: {
      webhookSubscription?: WebhookSubscription | null;
      userErrors?: UserError[];
    };
  }>(
    storeDomain,
    adminToken,
    `
      mutation WebhookSubscriptionCreate(
        $topic: WebhookSubscriptionTopic!,
        $webhookSubscription: WebhookSubscriptionInput!
      ) {
        webhookSubscriptionCreate(
          topic: $topic,
          webhookSubscription: $webhookSubscription
        ) {
          webhookSubscription {
            id
            topic
            format
            endpoint { __typename ... on WebhookHttpEndpoint { callbackUrl } }
            apiVersion { handle }
          }
          userErrors { field message }
        }
      }
    `,
    {
      topic: TOPIC,
      webhookSubscription: {
        callbackUrl: CALLBACK_URL,
        format: 'JSON',
      },
    },
  );

  const payload = data.webhookSubscriptionCreate;
  const userErrors = payload?.userErrors ?? [];
  if (userErrors.length) throw new Error(`userErrors: ${formatUserErrors(userErrors)}`);

  const subscription = payload?.webhookSubscription;
  if (!subscription) throw new Error('webhookSubscriptionCreate returned no webhookSubscription');

  return subscription;
}

async function countVerifiedSubscriptions(storeDomain: string, adminToken: string): Promise<number> {
  const data = await adminGraphql<{
    webhookSubscriptions?: {
      nodes?: WebhookSubscription[];
    };
  }>(
    storeDomain,
    adminToken,
    `
      query VerifyWebhookSubscription($topics: [WebhookSubscriptionTopic!]) {
        webhookSubscriptions(first: 250, topics: $topics) {
          nodes {
            id
            topic
            format
            endpoint { __typename ... on WebhookHttpEndpoint { callbackUrl } }
            apiVersion { handle }
          }
        }
      }
    `,
    { topics: [TOPIC] },
  );

  return data.webhookSubscriptions?.nodes?.length ?? 0;
}

async function main(): Promise<void> {
  loadEnvLocal();

  const storeDomain = getStoreDomain();
  const adminToken = await mintAdminAccessToken(storeDomain);
  const subscription = await createWebhookSubscription(storeDomain, adminToken);
  const verifiedCount = await countVerifiedSubscriptions(storeDomain, adminToken);

  process.stdout.write(`WEBHOOK_SUBSCRIPTION_ID: ${subscription.id}\n`);
  process.stdout.write(`CALLBACK_URL: ${getHttpCallbackUrl(subscription)}\n`);
  process.stdout.write(`TOPIC: ${TOPIC}\n`);
  process.stdout.write(`API_VERSION: ${API_VERSION}\n`);
  process.stdout.write(`VERIFIED: ${verifiedCount}\n`);
}

function formatError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);

  const cause = error.cause;
  if (cause instanceof Error && cause.message) {
    return `${error.message}: ${cause.message}`;
  }

  return error.message;
}

main().catch((error: unknown) => {
  const message = formatError(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
