/**
 * Shopify Metaobject helpers for the `mosaiko_contact_submission` type —
 * the private inbox backing the public contact form + admin Contactos view.
 *
 * Reuses the same Admin GraphQL client + `ShopifyUserErrorsError` /
 * `updateMetaobjectFields` helpers as `mutations/metaobjects.ts`. The
 * metaobject type is created by `scripts/seed-metaobject-definitions.mts`
 * with `access.storefront = NONE` (PII — never exposed via the Storefront
 * API). All reads/writes here go through the server-only Admin API.
 */
import { shopifyAdminFetch } from '@/lib/shopify/client';
import {
  ShopifyUserErrorsError,
  updateMetaobjectFields,
  type ShopifyUserError,
} from '@/lib/shopify/mutations/metaobjects';

export const CONTACT_SUBMISSION_TYPE = 'mosaiko_contact_submission';

// ─── createContactSubmission ────────────────────────────────────────────────

export const METAOBJECT_CREATE_MUTATION = /* GraphQL */ `
  mutation ContactSubmissionCreate($metaobject: MetaobjectCreateInput!) {
    metaobjectCreate(metaobject: $metaobject) {
      metaobject {
        id
        handle
      }
      userErrors {
        field
        message
        code
        elementIndex
        elementKey
      }
    }
  }
`;

interface MetaobjectCreateResponse {
  metaobjectCreate: {
    metaobject: { id: string; handle: string } | null;
    userErrors: ShopifyUserError[];
  };
}

/** Fields stored on a contact-submission metaobject. All locale-neutral. */
export interface ContactSubmissionInput {
  displayName: string;
  name: string;
  email: string;
  subject: string;
  message: string;
  status: string;
  createdAt: string;
  ipHash: string;
  locale: string;
  source: string;
}

const CONTACT_FIELD = {
  displayName: 'display_name',
  name: 'name',
  email: 'email',
  subject: 'subject',
  message: 'message',
  status: 'status',
  createdAt: 'created_at',
  ipHash: 'ip_hash',
  locale: 'locale',
  source: 'source',
} as const;

/**
 * Creates a contact-submission metaobject. Throws `ShopifyUserErrorsError`
 * if Shopify rejects. Returns the new metaobject id.
 */
export async function createContactSubmission(
  input: ContactSubmissionInput,
): Promise<string> {
  const fields = [
    { key: CONTACT_FIELD.displayName, value: input.displayName },
    { key: CONTACT_FIELD.name, value: input.name },
    { key: CONTACT_FIELD.email, value: input.email },
    { key: CONTACT_FIELD.subject, value: input.subject },
    { key: CONTACT_FIELD.message, value: input.message },
    { key: CONTACT_FIELD.status, value: input.status },
    { key: CONTACT_FIELD.createdAt, value: input.createdAt },
    { key: CONTACT_FIELD.ipHash, value: input.ipHash },
    { key: CONTACT_FIELD.locale, value: input.locale },
    { key: CONTACT_FIELD.source, value: input.source },
  ];
  const data = await shopifyAdminFetch<MetaobjectCreateResponse>({
    query: METAOBJECT_CREATE_MUTATION,
    variables: { metaobject: { type: CONTACT_SUBMISSION_TYPE, fields } },
    options: { cache: 'no-store' },
  });
  const result = data.metaobjectCreate;
  if (result.userErrors.length > 0) {
    throw new ShopifyUserErrorsError('metaobjectCreate', result.userErrors);
  }
  if (!result.metaobject) {
    throw new Error('metaobjectCreate returned null metaobject without userErrors');
  }
  return result.metaobject.id;
}

// ─── listContactSubmissions ─────────────────────────────────────────────────

export const CONTACT_SUBMISSIONS_QUERY = /* GraphQL */ `
  query ContactSubmissions($type: String!, $first: Int!) {
    metaobjects(type: $type, first: $first, sortKey: "updated_at", reverse: true) {
      nodes {
        id
        fields {
          key
          value
        }
      }
    }
  }
`;

interface ContactSubmissionsResponse {
  metaobjects: {
    nodes: Array<{
      id: string;
      fields: Array<{ key: string; value: string | null }>;
    }>;
  };
}

/** Parsed contact submission returned to the admin inbox. */
export interface ContactSubmission {
  id: string;
  name: string;
  email: string;
  subject: string;
  message: string;
  status: string;
  createdAt: string;
  locale: string;
}

function fieldsToRecord(
  fields: Array<{ key: string; value: string | null }>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of fields) {
    if (typeof f.value === 'string') out[f.key] = f.value;
  }
  return out;
}

/**
 * Lists contact submissions newest-first. Returns `[]` when none exist (or
 * the type isn't seeded — Shopify returns an empty connection). Throws on
 * Shopify errors (auth, network, GraphQL).
 */
export async function listContactSubmissions(
  { first = 50 }: { first?: number } = {},
): Promise<ContactSubmission[]> {
  const data = await shopifyAdminFetch<ContactSubmissionsResponse>({
    query: CONTACT_SUBMISSIONS_QUERY,
    variables: { type: CONTACT_SUBMISSION_TYPE, first },
    options: { cache: 'no-store' },
  });
  const nodes = data.metaobjects?.nodes ?? [];
  const submissions = nodes.map((node) => {
    const r = fieldsToRecord(node.fields);
    return {
      id: node.id,
      name: r[CONTACT_FIELD.name] ?? '',
      email: r[CONTACT_FIELD.email] ?? '',
      subject: r[CONTACT_FIELD.subject] ?? '',
      message: r[CONTACT_FIELD.message] ?? '',
      status: r[CONTACT_FIELD.status] ?? 'new',
      createdAt: r[CONTACT_FIELD.createdAt] ?? '',
      locale: r[CONTACT_FIELD.locale] ?? '',
    };
  });
  // The query sorts by `updated_at` (a valid Admin sortKey), but marking a
  // message read bumps updated_at — so re-sort by our own `created_at` (ISO,
  // lexicographically sortable) to keep the inbox in true submission order.
  return submissions.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

// ─── updateContactSubmissionStatus ──────────────────────────────────────────

/**
 * Updates only the `status` field on a submission (e.g. "new" → "read" /
 * "archived"). Reuses `updateMetaobjectFields` (metaobjectUpdate). Throws
 * `ShopifyUserErrorsError` on rejection.
 */
export async function updateContactSubmissionStatus(
  id: string,
  status: string,
): Promise<void> {
  await updateMetaobjectFields(id, [{ key: CONTACT_FIELD.status, value: status }]);
}
