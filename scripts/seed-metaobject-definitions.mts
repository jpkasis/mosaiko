/**
 * Idempotent seeder for Mosaiko's site-content Metaobject definitions.
 *
 * Creates three Metaobject types if they don't already exist:
 *   1. mosaiko_home_copy        (singleton) — hero + howItWorks copy
 *   2. mosaiko_faq_item         (repeated)  — FAQ list entries
 *   3. mosaiko_business_settings (singleton) — address / socials / notification email
 *
 * Also upserts blank singleton entries for the two singleton types so
 * /api/cart/load + the next-intl request boundary have a target to read.
 * Repeated types (FAQ) don't need a placeholder entry.
 *
 * Idempotency:
 *   - If a definition already exists, skips creation (logs "exists").
 *   - If a singleton entry already exists (handle="singleton"), skips upsert.
 *   - Does NOT mutate existing definitions — Shopify rejects most non-additive
 *     changes anyway. Field-list drift between code and Shopify must be
 *     resolved by deleting + recreating the definition manually in Admin.
 *
 * Usage (Node 22+):
 *   node --env-file=.env.local --experimental-strip-types scripts/seed-metaobject-definitions.mts
 *
 *   or:  npm run shopify:seed-metaobjects
 *
 * Required env (same as smoke-shopify.mts):
 *   - NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN
 *   - SHOPIFY_CLIENT_ID + SHOPIFY_CLIENT_SECRET  (preferred)
 *     OR SHOPIFY_ADMIN_API_TOKEN                 (transitional)
 *
 * Required app scopes:
 *   - read_metaobject_definitions, write_metaobject_definitions
 *   - read_metaobjects, write_metaobjects
 *
 * Exit codes: 0 = all green, 1 = any failure.
 */

const API_VERSION = '2026-04';

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
  skip: (msg: string) => console.log(`◇ ${msg}`),
  fail: (msg: string) => console.error(`✗ ${msg}`),
  section: (msg: string) => console.log(`\n── ${msg} ──`),
};

interface GraphQLResponse<T> {
  data?: T;
  errors?: Array<{ message: string }>;
}

async function adminFetch<T>(
  query: string,
  variables: Record<string, unknown> = {},
): Promise<T> {
  const res = await fetch(
    `https://${STORE_DOMAIN}/admin/api/${API_VERSION}/graphql.json`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': ADMIN_TOKEN,
      },
      body: JSON.stringify({ query, variables }),
    },
  );
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  }
  const json = (await res.json()) as GraphQLResponse<T>;
  if (json.errors?.length) {
    throw new Error(json.errors.map((e) => e.message).join('\n'));
  }
  if (!json.data) throw new Error('No data in response');
  return json.data;
}

// ─── Definition specs ──────────────────────────────────────────────────────

type FieldType =
  | 'single_line_text_field'
  | 'multi_line_text_field'
  | 'number_integer'
  | 'boolean';

interface FieldSpec {
  key: string;
  name: string;
  type: FieldType;
}

interface DefinitionSpec {
  type: string;
  name: string;
  description: string;
  singleton: boolean;
  fields: FieldSpec[];
  /**
   * Storefront read access for this type. Defaults to PUBLIC_READ (the headless
   * storefront reads CMS content). A private type would set 'NONE' so its data
   * is never exposed via the public Storefront API.
   */
  storefrontAccess?: 'PUBLIC_READ' | 'NONE';
  /** Enable the Shopify translations capability. Defaults to true (localized copy). */
  translatable?: boolean;
  /** Field key used as the entry's display name in Shopify Admin (optional). */
  displayNameKey?: string;
}

const DEFINITIONS: DefinitionSpec[] = [
  {
    type: 'mosaiko_home_copy',
    name: 'Home Copy',
    description: 'Editable copy for the home page hero + how-it-works sections',
    singleton: true,
    fields: [
      { key: 'hero_badge', name: 'Hero Badge', type: 'single_line_text_field' },
      { key: 'hero_title', name: 'Hero Title', type: 'single_line_text_field' },
      { key: 'hero_subtitle', name: 'Hero Subtitle', type: 'multi_line_text_field' },
      { key: 'hero_cta', name: 'Hero CTA', type: 'single_line_text_field' },
      { key: 'hero_cta_secondary', name: 'Hero CTA (secondary)', type: 'single_line_text_field' },
      { key: 'how_it_works_title', name: 'How-it-works Title', type: 'single_line_text_field' },
      { key: 'how_it_works_subtitle', name: 'How-it-works Subtitle', type: 'single_line_text_field' },
    ],
  },
  {
    type: 'mosaiko_faq_item',
    name: 'FAQ Item',
    description: 'A single frequently-asked-question entry',
    singleton: false,
    fields: [
      { key: 'question', name: 'Question', type: 'single_line_text_field' },
      { key: 'answer', name: 'Answer', type: 'multi_line_text_field' },
      { key: 'sort_order', name: 'Sort order', type: 'number_integer' },
      { key: 'active', name: 'Active', type: 'boolean' },
    ],
  },
  {
    type: 'mosaiko_business_settings',
    name: 'Business Settings',
    description: 'Business contact info + social links + notification email',
    singleton: true,
    fields: [
      { key: 'business_name', name: 'Business name', type: 'single_line_text_field' },
      { key: 'address', name: 'Address', type: 'multi_line_text_field' },
      { key: 'phone', name: 'Phone', type: 'single_line_text_field' },
      { key: 'whatsapp', name: 'WhatsApp', type: 'single_line_text_field' },
      { key: 'whatsapp_message', name: 'WhatsApp Message', type: 'multi_line_text_field' },
      { key: 'instagram_url', name: 'Instagram URL', type: 'single_line_text_field' },
      { key: 'facebook_url', name: 'Facebook URL', type: 'single_line_text_field' },
      { key: 'tiktok_url', name: 'TikTok URL', type: 'single_line_text_field' },
      // Legacy/dormant: not read by the app (order/staff emails are
      // Shopify-native). Kept so the live definition stays stable — do not
      // remove from existing stores.
      { key: 'notification_email', name: 'Order notification email', type: 'single_line_text_field' },
      { key: 'footer_copy', name: 'Footer copy', type: 'multi_line_text_field' },
    ],
  },
];

// ─── GraphQL operations ─────────────────────────────────────────────────────

const GET_DEFINITION_QUERY = /* GraphQL */ `
  query GetMetaobjectDefinition($type: String!) {
    metaobjectDefinitionByType(type: $type) {
      id
      type
      name
      fieldDefinitions {
        key
      }
    }
  }
`;

const CREATE_DEFINITION_MUTATION = /* GraphQL */ `
  mutation CreateMetaobjectDefinition($definition: MetaobjectDefinitionCreateInput!) {
    metaobjectDefinitionCreate(definition: $definition) {
      metaobjectDefinition {
        id
        type
        name
      }
      userErrors {
        field
        message
        code
      }
    }
  }
`;

const UPDATE_DEFINITION_MUTATION = /* GraphQL */ `
  mutation UpdateMetaobjectDefinition($id: ID!, $definition: MetaobjectDefinitionUpdateInput!) {
    metaobjectDefinitionUpdate(id: $id, definition: $definition) {
      metaobjectDefinition {
        id
        type
      }
      userErrors {
        field
        message
        code
      }
    }
  }
`;

const GET_METAOBJECT_QUERY = /* GraphQL */ `
  query GetMetaobject($type: String!, $handle: String!) {
    metaobjectByHandle(handle: { type: $type, handle: $handle }) {
      id
      handle
    }
  }
`;

const UPSERT_METAOBJECT_MUTATION = /* GraphQL */ `
  mutation UpsertMetaobject($handle: MetaobjectHandleInput!, $metaobject: MetaobjectUpsertInput!) {
    metaobjectUpsert(handle: $handle, metaobject: $metaobject) {
      metaobject {
        id
        handle
      }
      userErrors {
        field
        message
      }
    }
  }
`;

interface UserError {
  field?: string[];
  message: string;
  code?: string;
}

// ─── Operations ─────────────────────────────────────────────────────────────

async function ensureDefinition(spec: DefinitionSpec): Promise<void> {
  const existing = await adminFetch<{
    metaobjectDefinitionByType: {
      id: string;
      type: string;
      name: string;
      fieldDefinitions: { key: string }[];
    } | null;
  }>(GET_DEFINITION_QUERY, { type: spec.type });

  const existingDef = existing.metaobjectDefinitionByType;
  if (existingDef) {
    // Definition exists — idempotently ADD any spec fields the live definition
    // is missing (e.g. a field added to an already-shipped type). Only `create`
    // ops for missing keys are sent; existing fields are never resent. This
    // closes the deploy hazard where writing a new field key via
    // metaobjectUpdate would 502 because the definition lacked it. (Codex audit)
    const liveKeys = new Set(existingDef.fieldDefinitions.map((f) => f.key));
    const missing = spec.fields.filter((f) => !liveKeys.has(f.key));
    if (missing.length === 0) {
      log.skip(`${spec.type} — already exists (id: ${existingDef.id}), no new fields`);
      return;
    }
    const upd = await adminFetch<{
      metaobjectDefinitionUpdate: {
        metaobjectDefinition: { id: string; type: string } | null;
        userErrors: UserError[];
      };
    }>(UPDATE_DEFINITION_MUTATION, {
      id: existingDef.id,
      definition: {
        fieldDefinitions: missing.map((f) => ({
          create: { key: f.key, name: f.name, type: f.type },
        })),
      },
    });
    const updErrors = upd.metaobjectDefinitionUpdate.userErrors;
    if (updErrors.length > 0) {
      throw new Error(
        `metaobjectDefinitionUpdate userErrors:\n${updErrors
          .map((e) => `  - ${e.message}${e.code ? ` (${e.code})` : ''}`)
          .join('\n')}`,
      );
    }
    log.ok(
      `${spec.type} — added ${missing.length} field(s): ${missing
        .map((f) => f.key)
        .join(', ')}`,
    );
    return;
  }

  const fieldDefinitions = spec.fields.map((f) => ({
    key: f.key,
    name: f.name,
    type: f.type,
  }));

  const result = await adminFetch<{
    metaobjectDefinitionCreate: {
      metaobjectDefinition: { id: string; type: string; name: string } | null;
      userErrors: UserError[];
    };
  }>(CREATE_DEFINITION_MUTATION, {
    definition: {
      type: spec.type,
      name: spec.name,
      description: spec.description,
      fieldDefinitions,
      // Default PUBLIC_READ; PII types override to NONE.
      access: { storefront: spec.storefrontAccess ?? 'PUBLIC_READ' },
      capabilities: {
        translatable: { enabled: spec.translatable ?? true },
      },
      ...(spec.displayNameKey ? { displayNameKey: spec.displayNameKey } : {}),
    },
  });

  const errors = result.metaobjectDefinitionCreate.userErrors;
  if (errors.length > 0) {
    throw new Error(
      `metaobjectDefinitionCreate userErrors:\n${errors
        .map((e) => `  - ${e.message}${e.code ? ` (${e.code})` : ''}`)
        .join('\n')}`,
    );
  }
  const created = result.metaobjectDefinitionCreate.metaobjectDefinition;
  log.ok(`${spec.type} — created (id: ${created?.id})`);
}

async function ensureSingletonEntry(type: string): Promise<void> {
  const existing = await adminFetch<{
    metaobjectByHandle: { id: string; handle: string } | null;
  }>(GET_METAOBJECT_QUERY, { type, handle: 'singleton' });

  if (existing.metaobjectByHandle) {
    log.skip(`${type}/singleton — entry already exists`);
    return;
  }

  const result = await adminFetch<{
    metaobjectUpsert: {
      metaobject: { id: string; handle: string } | null;
      userErrors: UserError[];
    };
  }>(UPSERT_METAOBJECT_MUTATION, {
    handle: { type, handle: 'singleton' },
    metaobject: {
      fields: [],
    },
  });

  const errors = result.metaobjectUpsert.userErrors;
  if (errors.length > 0) {
    throw new Error(
      `metaobjectUpsert userErrors:\n${errors
        .map((e) => `  - ${e.message}`)
        .join('\n')}`,
    );
  }
  log.ok(`${type}/singleton — entry upserted (id: ${result.metaobjectUpsert.metaobject?.id})`);
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  log.section('Authenticating');
  ADMIN_TOKEN = await getAdminToken();
  log.ok(`Admin token acquired for ${STORE_DOMAIN}`);

  log.section('Metaobject definitions');
  for (const spec of DEFINITIONS) {
    try {
      await ensureDefinition(spec);
    } catch (error) {
      log.fail(`${spec.type} — ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    }
  }

  log.section('Singleton entries');
  for (const spec of DEFINITIONS.filter((d) => d.singleton)) {
    try {
      await ensureSingletonEntry(spec.type);
    } catch (error) {
      log.fail(`${spec.type}/singleton — ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    }
  }

  log.section('Done');
  log.ok('All definitions + singletons seeded.');
  log.info('Next: open Shopify Admin → Settings → Custom data → Metaobjects to fill in copy.');
}

main().catch((error) => {
  log.fail(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
