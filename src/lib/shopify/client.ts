import type { ShopifyResponse } from './types';

// ─── Configuration ──────────────────────────────────────────────────────────

const SHOPIFY_API_VERSION = '2026-04';

function getStoreDomain(): string {
  const domain =
    process.env.SHOPIFY_STORE_DOMAIN ??
    process.env.NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN;
  if (!domain) {
    throw new Error(
      '[Shopify] Missing NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN environment variable',
    );
  }
  return domain;
}

function getStorefrontToken(): string {
  const token = process.env.NEXT_PUBLIC_SHOPIFY_STOREFRONT_TOKEN;
  if (!token) {
    throw new Error(
      '[Shopify] Missing NEXT_PUBLIC_SHOPIFY_STOREFRONT_TOKEN environment variable',
    );
  }
  return token;
}

// ─── Admin access token (client-credentials grant) ──────────────────────────
//
// The new Shopify Dev Dashboard does not expose static `shpat_*` tokens.
// Instead, apps authenticate with the OAuth client-credentials grant: POST
// client_id + client_secret to `/admin/oauth/access_token`, get back a
// `shpat_*` token with ~24h TTL. We cache the token in module memory so a
// warm Vercel function reuses it across invocations; cold starts mint a
// fresh token (one extra HTTP call, ~150 ms).
//
// Backward-compat: if `SHOPIFY_ADMIN_API_TOKEN` is set, we use it directly
// without minting. This lets tests stub a fake token, and lets us bridge
// the migration without breaking local dev.

interface CachedToken {
  value: string;
  expiresAt: number;
}

let cachedAdminToken: CachedToken | null = null;
let pendingTokenFetch: Promise<string> | null = null;

const TOKEN_REFRESH_MARGIN_MS = 60 * 1000;

async function mintAdminToken(): Promise<string> {
  const clientId = process.env.SHOPIFY_CLIENT_ID;
  const clientSecret = process.env.SHOPIFY_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      '[Shopify] Missing SHOPIFY_CLIENT_ID and/or SHOPIFY_CLIENT_SECRET. ' +
        'Either set both for the client-credentials grant, or set ' +
        'SHOPIFY_ADMIN_API_TOKEN to a static token (tests, transitional).',
    );
  }
  const domain = getStoreDomain();
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
  });
  const res = await fetch(`https://${domain}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    cache: 'no-store',
  });
  if (!res.ok) {
    throw new Error(
      `[Shopify] Admin token mint HTTP ${res.status}: ${await res.text()}`,
    );
  }
  const data = (await res.json()) as {
    access_token: string;
    expires_in: number;
  };
  cachedAdminToken = {
    value: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
  return data.access_token;
}

/**
 * Returns a usable Shopify Admin API access token. Async because it may
 * mint via the client-credentials grant. Caches the token in module
 * memory and refreshes a minute before expiry. Concurrent callers
 * coalesce onto a single in-flight mint.
 */
export async function getAdminAccessToken(): Promise<string> {
  const staticToken = process.env.SHOPIFY_ADMIN_API_TOKEN;
  if (staticToken) return staticToken;

  const now = Date.now();
  if (cachedAdminToken && now < cachedAdminToken.expiresAt - TOKEN_REFRESH_MARGIN_MS) {
    return cachedAdminToken.value;
  }
  if (pendingTokenFetch) return pendingTokenFetch;

  pendingTokenFetch = mintAdminToken().finally(() => {
    pendingTokenFetch = null;
  });
  return pendingTokenFetch;
}

/**
 * True when the Admin API can be used — either a static token is set or
 * the client-credentials pair is set. Cheap; does not actually mint.
 */
export function isAdminConfigured(): boolean {
  if (process.env.SHOPIFY_ADMIN_API_TOKEN) return true;
  return Boolean(process.env.SHOPIFY_CLIENT_ID && process.env.SHOPIFY_CLIENT_SECRET);
}

// ─── Fetch options extending Next.js cache controls ─────────────────────────

export interface ShopifyFetchOptions {
  /** Next.js fetch cache mode */
  cache?: RequestCache;
  /** Next.js ISR / on-demand revalidation */
  next?: {
    revalidate?: number | false;
    tags?: string[];
  };
}

// ─── Storefront API fetch ───────────────────────────────────────────────────

/**
 * Executes a GraphQL query against the Shopify Storefront API.
 * Safe to call from both server and client components (uses public token).
 */
export async function shopifyFetch<T>({
  query,
  variables,
  options = {},
}: {
  query: string;
  variables?: Record<string, unknown>;
  options?: ShopifyFetchOptions;
}): Promise<T> {
  const domain = getStoreDomain();
  const endpoint = `https://${domain}/api/${SHOPIFY_API_VERSION}/graphql.json`;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Storefront-Access-Token': getStorefrontToken(),
    },
    body: JSON.stringify({ query, variables }),
    cache: options.cache,
    ...(options.next ? { next: options.next } : {}),
  } as RequestInit);

  if (!response.ok) {
    throw new Error(
      `[Shopify Storefront] HTTP ${response.status}: ${response.statusText}`,
    );
  }

  const json: ShopifyResponse<T> = await response.json();

  if (json.errors?.length) {
    const messages = json.errors.map((e) => e.message).join('\n');
    throw new Error(`[Shopify Storefront] GraphQL errors:\n${messages}`);
  }

  return json.data;
}

// ─── Admin API fetch ────────────────────────────────────────────────────────

/**
 * Executes a GraphQL query against the Shopify Admin API.
 * Server-only — must only be called from API routes, server actions, or
 * server components. Never expose the admin token to the client.
 */
export async function shopifyAdminFetch<T>({
  query,
  variables,
  options = {},
}: {
  query: string;
  variables?: Record<string, unknown>;
  options?: ShopifyFetchOptions;
}): Promise<T> {
  const domain = getStoreDomain();
  const endpoint = `https://${domain}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': await getAdminAccessToken(),
    },
    body: JSON.stringify({ query, variables }),
    cache: options.cache,
    ...(options.next ? { next: options.next } : {}),
  } as RequestInit);

  if (!response.ok) {
    throw new Error(
      `[Shopify Admin] HTTP ${response.status}: ${response.statusText}`,
    );
  }

  const json: ShopifyResponse<T> = await response.json();

  if (json.errors?.length) {
    const messages = json.errors.map((e) => e.message).join('\n');
    throw new Error(`[Shopify Admin] GraphQL errors:\n${messages}`);
  }

  return json.data;
}

// Re-export the API version so REST consumers (which build their own URLs)
// stay in lock-step with the GraphQL clients.
export { SHOPIFY_API_VERSION };
