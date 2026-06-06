import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const STORE_DOMAIN = 'mosaiko-mx.myshopify.com';
const API_VERSION = '2026-04';
const TOKEN_TITLE = 'mosaiko-storefront-prod';

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

async function mintAdminAccessToken(): Promise<string> {
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: requireEnv('SHOPIFY_CLIENT_ID'),
    client_secret: requireEnv('SHOPIFY_CLIENT_SECRET'),
  });

  const res = await fetch(`https://${STORE_DOMAIN}/admin/oauth/access_token`, {
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

async function createStorefrontAccessToken(adminToken: string): Promise<string> {
  const res = await fetch(`https://${STORE_DOMAIN}/admin/api/${API_VERSION}/graphql.json`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': adminToken,
    },
    body: JSON.stringify({
      query: `
        mutation StorefrontAccessTokenCreate($input: StorefrontAccessTokenInput!) {
          storefrontAccessTokenCreate(input: $input) {
            storefrontAccessToken {
              accessToken
            }
            userErrors {
              field
              message
            }
          }
        }
      `,
      variables: { input: { title: TOKEN_TITLE } },
    }),
  });

  if (!res.ok) {
    throw new Error(`Admin GraphQL HTTP ${res.status}: ${await res.text()}`);
  }

  const json = (await res.json()) as {
    data?: {
      storefrontAccessTokenCreate?: {
        storefrontAccessToken?: { accessToken?: string } | null;
        userErrors?: Array<{ field?: string[] | null; message: string }>;
      };
    };
    errors?: Array<{ message: string }>;
  };

  if (json.errors?.length) {
    throw new Error(`Admin GraphQL errors: ${json.errors.map((e) => e.message).join('; ')}`);
  }

  const payload = json.data?.storefrontAccessTokenCreate;
  const userErrors = payload?.userErrors ?? [];
  if (userErrors.length) {
    throw new Error(
      `userErrors: ${userErrors
        .map((e) => `${e.field?.join('.') || '(root)'}: ${e.message}`)
        .join('; ')}`,
    );
  }

  const token = payload?.storefrontAccessToken?.accessToken;
  if (!token) throw new Error('storefrontAccessTokenCreate returned no accessToken');
  if (!/^[0-9a-f]{32}$/i.test(token)) {
    throw new Error(`Unexpected storefront token format: ${token.length} chars`);
  }

  return token;
}

async function main(): Promise<void> {
  loadEnvLocal();
  const adminToken = await mintAdminAccessToken();
  const storefrontToken = await createStorefrontAccessToken(adminToken);
  process.stdout.write(`${storefrontToken}\n`);
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
