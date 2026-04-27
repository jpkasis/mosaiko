/**
 * Cleanup stale historical metafields.
 *
 * Background: orders processed before the pipeline-integrity branch
 * wrote metafields via REST `POST /metafields.json`, which always
 * CREATES a new metafield row. Re-runs of the same key would leave 2+
 * rows for the same `(namespace, key)` tuple per order. The webhook
 * now uses the GraphQL `metafieldsSet` mutation which upserts by
 * `(ownerId, namespace, key)`, so new runs no longer accumulate
 * duplicates — but historical orders may still carry them.
 *
 * What this script does:
 *   1. Lists Shopify orders updated in the last N days (default 90).
 *   2. For each order, fetches all `mosaiko`-namespace metafields.
 *   3. Groups by `(namespace, key)` and identifies any group with > 1
 *      entry. Keeps the most recently updated entry; everything else
 *      is a duplicate.
 *   4. In --dry-run mode (default): prints the duplicates that would
 *      be deleted.
 *   5. With --apply: deletes the duplicates via `metafieldsDelete`.
 *
 * Usage (Node 22+ for built-in --env-file):
 *   node --env-file=.env.local --experimental-strip-types scripts/cleanup-stale-metafields.mts
 *   node --env-file=.env.local --experimental-strip-types scripts/cleanup-stale-metafields.mts --apply
 *   node --env-file=.env.local --experimental-strip-types scripts/cleanup-stale-metafields.mts --days=30
 *
 * Or with tsx:
 *   npx tsx --env-file=.env.local scripts/cleanup-stale-metafields.mts [--apply] [--days=30]
 *
 * Requires `.env.local` with `SHOPIFY_STORE_DOMAIN` and
 * `SHOPIFY_ADMIN_TOKEN` set. Run with care; the apply path is
 * destructive.
 *
 * Codex Phase 5 Appendix I cleanup deliverable. Low urgency: every
 * subsequent webhook run upserts via `metafieldsSet`, so duplicates
 * stop accumulating once the new code is in production. This script
 * exists for one-off historical cleanup.
 */

interface MetafieldNode {
  id: string;
  namespace: string;
  key: string;
  type: string;
  value: string;
  createdAt: string;
  updatedAt: string;
}

interface OrderNode {
  id: string;
  name: string;
  updatedAt: string;
  metafields: {
    pageInfo?: { hasNextPage: boolean; endCursor: string | null };
    edges: { node: MetafieldNode }[];
  };
}

interface OrdersResp {
  orders: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    edges: { node: OrderNode }[];
  };
}

const ORDERS_QUERY = /* GraphQL */ `
  query OrdersUpdatedSince(
    $cursor: String,
    $query: String!,
    $mfCursor: String
  ) {
    orders(first: 50, after: $cursor, query: $query) {
      pageInfo { hasNextPage endCursor }
      edges {
        node {
          id
          name
          updatedAt
          metafields(first: 250, namespace: "mosaiko", after: $mfCursor) {
            pageInfo { hasNextPage endCursor }
            edges {
              node {
                id
                namespace
                key
                type
                value
                createdAt
                updatedAt
              }
            }
          }
        }
      }
    }
  }
`;

// Per-order metafield-only query for paginating heavily-duplicated
// orders. `metafields` connection caps at 250 per page; an order with
// 2-3 duplicates per of the 4 keys is well under, but historical
// REST-create loops occasionally produced higher counts.
const ORDER_MF_PAGE_QUERY = /* GraphQL */ `
  query OrderMetafieldsPage($id: ID!, $cursor: String) {
    order(id: $id) {
      id
      metafields(first: 250, namespace: "mosaiko", after: $cursor) {
        pageInfo { hasNextPage endCursor }
        edges {
          node {
            id
            namespace
            key
            type
            value
            createdAt
            updatedAt
          }
        }
      }
    }
  }
`;

function parseFlags(): { apply: boolean; days: number } {
  const apply = process.argv.includes('--apply');
  const daysArg = process.argv.find((a) => a.startsWith('--days='));
  const days = daysArg ? Number.parseInt(daysArg.split('=')[1], 10) : 90;
  if (!Number.isFinite(days) || days <= 0) {
    throw new Error(`Invalid --days value: ${daysArg}`);
  }
  return { apply, days };
}

async function adminFetch<T>(
  query: string,
  variables: Record<string, unknown>,
): Promise<T> {
  const domain = process.env.SHOPIFY_STORE_DOMAIN;
  const token = process.env.SHOPIFY_ADMIN_TOKEN;
  if (!domain || !token) {
    throw new Error(
      'Missing SHOPIFY_STORE_DOMAIN or SHOPIFY_ADMIN_TOKEN in .env.local',
    );
  }
  const url = `https://${domain}/admin/api/2024-10/graphql.json`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': token,
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) {
    throw new Error(`Shopify Admin HTTP ${res.status}: ${res.statusText}`);
  }
  const json = (await res.json()) as { data?: T; errors?: { message: string }[] };
  if (json.errors?.length) {
    throw new Error(
      `Shopify Admin GraphQL: ${json.errors.map((e) => e.message).join('; ')}`,
    );
  }
  if (!json.data) throw new Error('Shopify Admin returned no data');
  return json.data;
}

interface OrderMfPageResp {
  order: {
    id: string;
    metafields: {
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
      edges: { node: MetafieldNode }[];
    } | null;
  } | null;
}

async function fetchAllMetafieldsForOrder(
  orderId: string,
  initialEdges: { node: MetafieldNode }[],
  initialPageInfo: { hasNextPage: boolean; endCursor: string | null },
): Promise<MetafieldNode[]> {
  const all: MetafieldNode[] = initialEdges.map((e) => e.node);
  let pageInfo = initialPageInfo;
  while (pageInfo.hasNextPage && pageInfo.endCursor) {
    const resp = await adminFetch<OrderMfPageResp>(ORDER_MF_PAGE_QUERY, {
      id: orderId,
      cursor: pageInfo.endCursor,
    });
    const mf = resp.order?.metafields;
    if (!mf) break;
    for (const edge of mf.edges) all.push(edge.node);
    pageInfo = mf.pageInfo;
  }
  return all;
}

async function listOrdersWithMetafields(days: number): Promise<OrderNode[]> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const isoDate = since.toISOString().split('T')[0];
  const queryString = `updated_at:>='${isoDate}'`;

  const orders: OrderNode[] = [];
  let cursor: string | null = null;
  do {
    const data: OrdersResp = await adminFetch<OrdersResp>(ORDERS_QUERY, {
      cursor,
      query: queryString,
      mfCursor: null,
    });
    for (const edge of data.orders.edges) {
      const order = edge.node;
      // Heavily-duplicated orders may exceed the per-page metafield cap;
      // walk the cursor until exhausted so the duplicate detector sees
      // every row.
      const allMf = await fetchAllMetafieldsForOrder(
        order.id,
        order.metafields.edges,
        order.metafields.pageInfo ?? { hasNextPage: false, endCursor: null },
      );
      orders.push({ ...order, metafields: { edges: allMf.map((node) => ({ node })) } });
    }
    cursor = data.orders.pageInfo.hasNextPage
      ? data.orders.pageInfo.endCursor
      : null;
  } while (cursor);
  return orders;
}

interface DuplicateSet {
  orderId: string;
  orderName: string;
  namespace: string;
  key: string;
  keep: MetafieldNode;
  remove: MetafieldNode[];
}

function findDuplicates(orders: OrderNode[]): DuplicateSet[] {
  const sets: DuplicateSet[] = [];
  for (const order of orders) {
    const groups = new Map<string, MetafieldNode[]>();
    for (const edge of order.metafields.edges) {
      const m = edge.node;
      const k = `${m.namespace}:${m.key}`;
      const arr = groups.get(k) ?? [];
      arr.push(m);
      groups.set(k, arr);
    }
    for (const [, list] of groups) {
      if (list.length <= 1) continue;
      // Keep the most recently updated; remove the rest.
      list.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      const [keep, ...remove] = list;
      sets.push({
        orderId: order.id,
        orderName: order.name,
        namespace: keep.namespace,
        key: keep.key,
        keep,
        remove,
      });
    }
  }
  return sets;
}

/**
 * GraphQL `metafieldsDelete` takes an array of `MetafieldIdentifierInput`
 * keyed by `(ownerId, namespace, key)` — which is exactly the tuple we
 * want to KEEP one of, not blindly delete by. There's no GraphQL
 * by-ID delete for metafields. The REST endpoint
 *   DELETE /admin/api/{version}/metafields/{numeric_id}.json
 * is the only safe path for surgically removing duplicate rows while
 * preserving the most-recent row in the same `(namespace, key)` group.
 *
 * The metafield ID coming back from GraphQL is a GID like
 *   gid://shopify/Metafield/12345
 * REST expects just the numeric trailing segment.
 */
function gidToNumeric(gid: string): string | null {
  const m = /^gid:\/\/shopify\/Metafield\/(\d+)$/.exec(gid);
  return m ? m[1] : null;
}

async function deleteMetafieldByRest(numericId: string): Promise<void> {
  const domain = process.env.SHOPIFY_STORE_DOMAIN;
  const token = process.env.SHOPIFY_ADMIN_TOKEN;
  if (!domain || !token) {
    throw new Error(
      'Missing SHOPIFY_STORE_DOMAIN or SHOPIFY_ADMIN_TOKEN in .env.local',
    );
  }
  const url = `https://${domain}/admin/api/2024-10/metafields/${numericId}.json`;
  const res = await fetch(url, {
    method: 'DELETE',
    headers: { 'X-Shopify-Access-Token': token },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(
      `REST DELETE /metafields/${numericId} failed: HTTP ${res.status} ${res.statusText} — ${body}`,
    );
  }
}

async function deleteMetafields(gids: string[]): Promise<number> {
  let deleted = 0;
  for (const gid of gids) {
    const numeric = gidToNumeric(gid);
    if (!numeric) {
      console.error(`  ⚠ skip ${gid}: cannot derive numeric ID`);
      continue;
    }
    try {
      await deleteMetafieldByRest(numeric);
      deleted += 1;
    } catch (err) {
      console.error(`  ⚠ failed to delete ${gid}: ${(err as Error).message}`);
    }
  }
  return deleted;
}

async function main(): Promise<void> {
  const { apply, days } = parseFlags();
  console.log(
    `[cleanup-stale-metafields] mode=${apply ? 'APPLY' : 'DRY-RUN'} days=${days}`,
  );

  const orders = await listOrdersWithMetafields(days);
  console.log(`Scanned ${orders.length} orders updated in the last ${days} days.`);

  const duplicates = findDuplicates(orders);
  if (duplicates.length === 0) {
    console.log('No duplicate metafields found. Nothing to clean up.');
    return;
  }

  let totalRemove = 0;
  for (const set of duplicates) {
    totalRemove += set.remove.length;
    console.log(
      `\nOrder ${set.orderName} (${set.orderId})`,
      `\n  ${set.namespace}:${set.key} — ${set.remove.length} duplicate(s)`,
      `\n  KEEP    ${set.keep.id}  updated=${set.keep.updatedAt}`,
    );
    for (const m of set.remove) {
      console.log(`  REMOVE  ${m.id}  updated=${m.updatedAt}`);
    }
  }

  console.log(
    `\nTotal: ${duplicates.length} (namespace, key) groups across ${orders.length} orders, ${totalRemove} duplicate row(s) to remove.`,
  );

  if (!apply) {
    console.log('\nDRY-RUN — no metafields deleted. Re-run with --apply to delete.');
    return;
  }

  console.log('\nApplying deletes (via REST DELETE /metafields/{id})…');
  const ids = duplicates.flatMap((d) => d.remove.map((m) => m.id));
  const deleted = await deleteMetafields(ids);
  console.log(`Deleted ${deleted}/${ids.length} metafield row(s).`);
}

main().catch((err) => {
  console.error('[cleanup-stale-metafields] FAILED:', err);
  process.exit(1);
});
