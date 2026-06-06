/**
 * Contract test: contact-submission Shopify metaobject helpers.
 *
 *   - createContactSubmission: posts metaobjectCreate with type + fields,
 *     returns id, throws ShopifyUserErrorsError on userErrors
 *   - listContactSubmissions: queries metaobjects(type), parses fields
 *   - updateContactSubmissionStatus: posts metaobjectUpdate with status only
 */
import { describe, test, expect, vi, beforeEach } from 'vitest';

const mockAdminFetch = vi.fn();
vi.mock('@/lib/shopify/client', () => ({
  shopifyAdminFetch: (args: unknown) => mockAdminFetch(args),
}));

beforeEach(() => {
  mockAdminFetch.mockReset();
});

const INPUT = {
  displayName: 'Ana — Pregunta',
  name: 'Ana',
  email: 'ana@example.com',
  subject: 'Pregunta',
  message: 'Hola, tengo una duda sobre envíos.',
  status: 'new',
  createdAt: '2026-06-06T00:00:00.000Z',
  ipHash: 'deadbeef',
  locale: 'es',
  source: 'contact_form',
};

describe('createContactSubmission', () => {
  test('posts metaobjectCreate with the contact type + mapped fields', async () => {
    mockAdminFetch.mockResolvedValue({
      metaobjectCreate: {
        metaobject: { id: 'gid://shopify/Metaobject/9', handle: 'abc' },
        userErrors: [],
      },
    });
    const { createContactSubmission } = await import(
      '@/lib/shopify/mutations/contact-submissions'
    );
    const id = await createContactSubmission(INPUT);
    expect(id).toBe('gid://shopify/Metaobject/9');
    expect(mockAdminFetch).toHaveBeenCalledTimes(1);
    const call = mockAdminFetch.mock.calls[0][0] as {
      query: string;
      variables: { metaobject: { type: string; fields: Array<{ key: string; value: string }> } };
    };
    expect(call.query).toContain('metaobjectCreate');
    expect(call.variables.metaobject.type).toBe('mosaiko_contact_submission');
    const keys = call.variables.metaobject.fields.map((f) => f.key);
    expect(keys).toEqual(
      expect.arrayContaining([
        'display_name',
        'name',
        'email',
        'subject',
        'message',
        'status',
        'created_at',
        'ip_hash',
        'locale',
        'source',
      ]),
    );
    const emailField = call.variables.metaobject.fields.find((f) => f.key === 'email');
    expect(emailField?.value).toBe('ana@example.com');
  });

  test('throws ShopifyUserErrorsError on userErrors', async () => {
    mockAdminFetch.mockResolvedValue({
      metaobjectCreate: {
        metaobject: null,
        userErrors: [{ field: ['fields'], message: 'invalid', code: 'INVALID' }],
      },
    });
    const { createContactSubmission } = await import(
      '@/lib/shopify/mutations/contact-submissions'
    );
    const { ShopifyUserErrorsError } = await import(
      '@/lib/shopify/mutations/metaobjects'
    );
    await expect(createContactSubmission(INPUT)).rejects.toBeInstanceOf(
      ShopifyUserErrorsError,
    );
  });
});

describe('listContactSubmissions', () => {
  test('queries metaobjects(type) and parses fields into the public shape', async () => {
    mockAdminFetch.mockResolvedValue({
      metaobjects: {
        nodes: [
          {
            id: 'gid://1',
            fields: [
              { key: 'name', value: 'Ana' },
              { key: 'email', value: 'ana@example.com' },
              { key: 'subject', value: 'Hola' },
              { key: 'message', value: 'Mensaje' },
              { key: 'status', value: 'new' },
              { key: 'created_at', value: '2026-06-06T00:00:00.000Z' },
              { key: 'locale', value: 'es' },
              { key: 'ip_hash', value: 'secret-hash' },
            ],
          },
        ],
      },
    });
    const { listContactSubmissions } = await import(
      '@/lib/shopify/mutations/contact-submissions'
    );
    const rows = await listContactSubmissions({ first: 10 });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      id: 'gid://1',
      name: 'Ana',
      email: 'ana@example.com',
      subject: 'Hola',
      message: 'Mensaje',
      status: 'new',
      createdAt: '2026-06-06T00:00:00.000Z',
      locale: 'es',
    });
    // ip_hash must NOT leak into the admin-facing shape.
    expect(JSON.stringify(rows[0])).not.toContain('secret-hash');
    const call = mockAdminFetch.mock.calls[0][0] as {
      query: string;
      variables: Record<string, unknown>;
    };
    expect(call.query).toContain('metaobjects(');
    expect(call.variables).toMatchObject({ type: 'mosaiko_contact_submission', first: 10 });
  });

  test('empty connection → []', async () => {
    mockAdminFetch.mockResolvedValue({ metaobjects: { nodes: [] } });
    const { listContactSubmissions } = await import(
      '@/lib/shopify/mutations/contact-submissions'
    );
    expect(await listContactSubmissions()).toEqual([]);
  });
});

describe('updateContactSubmissionStatus', () => {
  test('posts metaobjectUpdate writing only the status field', async () => {
    mockAdminFetch.mockResolvedValue({
      metaobjectUpdate: {
        metaobject: { id: 'gid://1', type: 'mosaiko_contact_submission', handle: 'h', fields: [] },
        userErrors: [],
      },
    });
    const { updateContactSubmissionStatus } = await import(
      '@/lib/shopify/mutations/contact-submissions'
    );
    await updateContactSubmissionStatus('gid://1', 'read');
    expect(mockAdminFetch).toHaveBeenCalledTimes(1);
    const call = mockAdminFetch.mock.calls[0][0] as {
      query: string;
      variables: { id: string; metaobject: { fields: Array<{ key: string; value: string }> } };
    };
    expect(call.query).toContain('metaobjectUpdate');
    expect(call.variables.id).toBe('gid://1');
    expect(call.variables.metaobject.fields).toEqual([{ key: 'status', value: 'read' }]);
  });
});
