/**
 * Cleanup orphan R2 tile objects.
 *
 * Background: before BLOCKER #2 was fixed (Promise.allSettled +
 * UploadFailure structured throw), a partial Promise.all failure during
 * `uploadPrintTiles` could leave individual tile objects in R2 with no
 * corresponding metafield URL. Storage is cheap and deterministic-key
 * retries overwrite eventually, but a one-shot prune is sometimes
 * desirable.
 *
 * What this script does:
 *   1. Lists all keys under `print-files/` in the R2 print-files bucket
 *      (paginates via continuation tokens internally; LIST is unbounded).
 *   2. Groups keys by their `print-files/order-<orderId>-item-<lineId>`
 *      prefix — the deterministic shape from `src/lib/storage.ts`.
 *   3. For each unique order/line, queries Shopify's
 *      `print_pipeline_results` metafield to recover the canonical URL
 *      list. Parses each URL via `parseR2KeyFromPublicUrl` to derive
 *      the canonical key set.
 *   4. Computes orphans = (R2 keys for order/line) − (metafield keys).
 *   5. In --dry-run mode (default): prints orphans.
 *   6. With --apply: deletes orphan keys via `deleteFile`.
 *
 * Usage (Node 22+ for built-in --env-file):
 *   node --env-file=.env.local --experimental-strip-types scripts/cleanup-orphan-r2-tiles.mts
 *   node --env-file=.env.local --experimental-strip-types scripts/cleanup-orphan-r2-tiles.mts --apply
 *
 * Or with tsx:
 *   npx tsx --env-file=.env.local scripts/cleanup-orphan-r2-tiles.mts [--apply]
 *
 * Requires `.env.local` with R2 + Shopify credentials.
 *
 * Codex Phase 5 Appendix I cleanup deliverable. Very low urgency:
 * `UploadFailure.succeeded` is now surfaced at the storage layer, so
 * future partial failures throw cleanly. This handles historical
 * orphans only.
 */

import { listFiles, deleteFile } from '../src/lib/storage';
import { parseR2KeyFromPublicUrl } from '../src/lib/shopify/pipeline-metafields';

interface PipelineResultEntry {
  lineItemId: number;
  kind: 'ok' | 'failed';
  urls?: string[];
}

interface MetafieldNode {
  id: string;
  namespace: string;
  key: string;
  value: string;
  updatedAt: string;
}

interface OrderMetafieldsResp {
  order: {
    id: string;
    name: string;
    metafields: {
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
      edges: { node: MetafieldNode }[];
    };
  } | null;
}

// Use the plural connection — historical orders may carry duplicate
// `print_pipeline_results` rows (REST POST /metafields.json never
// upserted). Singular `metafield(namespace, key)` returns ONE row but
// not necessarily the most recent. Fetching all and picking newest by
// updatedAt is the only safe option until duplicates are cleaned up.
//
// Connection caps at 250 per page; a heavily-duplicated order with more
// than 250 mosaiko metafields needs cursor pagination, otherwise the
// newest row may sit past the first page and we'd select a stale value
// that would cause this script to misclassify live tiles as orphans.
const ORDER_METAFIELDS_QUERY = /* GraphQL */ `
  query OrderPipelineResults($id: ID!, $cursor: String) {
    order(id: $id) {
      id
      name
      metafields(first: 250, namespace: "mosaiko", after: $cursor) {
        pageInfo { hasNextPage endCursor }
        edges {
          node {
            id
            namespace
            key
            value
            updatedAt
          }
        }
      }
    }
  }
`;

function parseFlags(): { apply: boolean } {
  return { apply: process.argv.includes('--apply') };
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

/**
 * Group R2 keys by their `print-files/order-<id>-item-<lineId>` prefix.
 * Keys outside this shape (legacy / non-tile) are returned in a separate
 * bucket so the operator can decide what to do with them.
 */
function groupKeysByOrderLine(keys: string[]): {
  byPrefix: Map<string, string[]>;
  unknown: string[];
} {
  const byPrefix = new Map<string, string[]>();
  const unknown: string[] = [];
  const re = /^(print-files\/order-[\w-]+-item-\d+)\/tile-\d+\.png$/;
  for (const key of keys) {
    const match = re.exec(key);
    if (!match) {
      unknown.push(key);
      continue;
    }
    const prefix = match[1];
    const arr = byPrefix.get(prefix) ?? [];
    arr.push(key);
    byPrefix.set(prefix, arr);
  }
  return { byPrefix, unknown };
}

/**
 * From a key-prefix like `print-files/order-1234567890-item-987654321`
 * derive the Shopify order GID + lineItemId for the metafield query.
 */
function parsePrefix(
  prefix: string,
): { orderGid: string; lineItemId: number } | null {
  const re = /^print-files\/order-([\w-]+)-item-(\d+)$/;
  const m = re.exec(prefix);
  if (!m) return null;
  const orderId = m[1];
  const lineItemId = Number.parseInt(m[2], 10);
  if (!Number.isSafeInteger(lineItemId)) return null;
  return {
    orderGid: `gid://shopify/Order/${orderId}`,
    lineItemId,
  };
}

type CanonicalResult =
  | { kind: 'ok'; keys: Set<string> }
  // `parse-fail` means we found the metafield but at least one URL
  // didn't pass `parseR2KeyFromPublicUrl`. We MUST fail closed (treat
  // canonical set as unknown), otherwise apply mode would mark live
  // tiles as orphans whenever the canonical URLs are stored against a
  // different `R2_PUBLIC_URL` origin (e.g. domain change, historical
  // tampering, env var mismatch on this run vs. when tiles were
  // produced).
  | { kind: 'parse-fail'; reason: string }
  | { kind: 'no-metafield' };

async function fetchCanonicalKeys(
  orderGid: string,
  lineItemId: number,
): Promise<CanonicalResult> {
  // Walk the metafields connection until exhausted. The newest
  // `print_pipeline_results` row is the canonical truth; if the
  // connection is paginated we MUST visit every page to be sure.
  const allMetafields: MetafieldNode[] = [];
  let cursor: string | null = null;
  let pageCount = 0;
  do {
    let resp: OrderMetafieldsResp;
    try {
      resp = await adminFetch<OrderMetafieldsResp>(ORDER_METAFIELDS_QUERY, {
        id: orderGid,
        cursor,
      });
    } catch (err) {
      return { kind: 'parse-fail', reason: (err as Error).message };
    }
    const mf = resp.order?.metafields;
    if (!mf) break;
    for (const edge of mf.edges) allMetafields.push(edge.node);
    cursor = mf.pageInfo.hasNextPage ? mf.pageInfo.endCursor : null;
    pageCount += 1;
    // Hard ceiling to defend against misbehaving APIs returning
    // hasNextPage=true forever. 250 × 20 = 5000 metafields per order is
    // already implausibly high; bail rather than spin.
    if (pageCount > 20) {
      return {
        kind: 'parse-fail',
        reason: 'metafield connection exceeded 20 pages — aborting',
      };
    }
  } while (cursor);

  // Filter by key + sort by updatedAt desc + take newest. Guards
  // against historical duplicate rows (pre-pipeline-integrity REST
  // POSTs) returning a stale value.
  const candidates = allMetafields
    .filter((n) => n.namespace === 'mosaiko' && n.key === 'print_pipeline_results')
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  if (candidates.length === 0) return { kind: 'no-metafield' };

  const value = candidates[0].value;
  let parsed: PipelineResultEntry[];
  try {
    parsed = JSON.parse(value) as PipelineResultEntry[];
  } catch {
    return { kind: 'parse-fail', reason: 'metafield value is not valid JSON' };
  }
  const entry = parsed.find(
    (e) => e.lineItemId === lineItemId && e.kind === 'ok',
  );
  if (!entry?.urls) return { kind: 'no-metafield' };

  const orderId = orderGid.replace(/^gid:\/\/shopify\/Order\//, '');
  const keys = new Set<string>();
  for (const url of entry.urls) {
    const parsedKey = parseR2KeyFromPublicUrl(url, {
      orderId,
      lineItemId,
    });
    if (!parsedKey) {
      // Fail closed: any canonical URL we can't parse means the
      // canonical-set we'd compute is incomplete, and ALL R2 keys for
      // this line would falsely look like orphans.
      return {
        kind: 'parse-fail',
        reason: `canonical URL not parseable: ${url}`,
      };
    }
    keys.add(parsedKey.key);
  }
  return { kind: 'ok', keys };
}

async function main(): Promise<void> {
  const { apply } = parseFlags();
  console.log(
    `[cleanup-orphan-r2-tiles] mode=${apply ? 'APPLY' : 'DRY-RUN'}`,
  );

  console.log('Listing R2 print-files…');
  const allKeys = await listFiles('print-files', 'print-files/');
  console.log(`Found ${allKeys.length} key(s).`);

  const { byPrefix, unknown } = groupKeysByOrderLine(allKeys);
  console.log(
    `Grouped into ${byPrefix.size} order/line prefix(es). ${unknown.length} key(s) outside the expected shape (skipped — see --include-unknown TODO).`,
  );

  const orphansToDelete: string[] = [];
  let totalReferenced = 0;
  let skippedNoMetafield = 0;
  let skippedParseFail = 0;

  for (const [prefix, keys] of byPrefix) {
    const parsed = parsePrefix(prefix);
    if (!parsed) {
      console.log(`  ⚠ Cannot parse prefix: ${prefix} — skipping`);
      continue;
    }
    const canonical = await fetchCanonicalKeys(
      parsed.orderGid,
      parsed.lineItemId,
    );
    if (canonical.kind === 'no-metafield') {
      skippedNoMetafield += 1;
      console.log(
        `  ? ${prefix}: no metafield — skipping (${keys.length} key(s))`,
      );
      continue;
    }
    if (canonical.kind === 'parse-fail') {
      // Fail closed: never mark anything as an orphan if we can't
      // verify the canonical URL set. Operator must investigate
      // manually (often an env-var mismatch or historical domain).
      skippedParseFail += 1;
      console.log(
        `  ⚠ ${prefix}: canonical-key resolution failed — skipping (${keys.length} key(s)). Reason: ${canonical.reason}`,
      );
      continue;
    }
    const orphans = keys.filter((k) => !canonical.keys.has(k));
    totalReferenced += keys.length - orphans.length;
    if (orphans.length === 0) continue;
    console.log(`\n${prefix}: ${orphans.length} orphan(s)`);
    for (const k of orphans) {
      console.log(`  ORPHAN  ${k}`);
    }
    orphansToDelete.push(...orphans);
  }

  console.log(
    `\nSummary:` +
      `\n  ${totalReferenced} key(s) referenced by metafields (kept).` +
      `\n  ${orphansToDelete.length} orphan(s) eligible for deletion.` +
      `\n  ${skippedNoMetafield} order/line prefix(es) skipped (no metafield).` +
      `\n  ${skippedParseFail} order/line prefix(es) skipped (canonical-resolution failed — fail-closed).`,
  );

  if (!apply) {
    console.log('\nDRY-RUN — no R2 objects deleted. Re-run with --apply to delete.');
    return;
  }

  if (orphansToDelete.length === 0) {
    console.log('Nothing to delete.');
    return;
  }

  console.log('\nDeleting orphans…');
  // R2 deleteFile is single-key. Run sequentially so an error mid-stream
  // surfaces immediately and the operator can inspect; throughput is not
  // a concern for a one-off cleanup.
  let deleted = 0;
  for (const key of orphansToDelete) {
    try {
      await deleteFile('print-files', key);
      deleted += 1;
    } catch (err) {
      console.error(`  ⚠ failed to delete ${key}: ${(err as Error).message}`);
    }
  }
  console.log(`Deleted ${deleted}/${orphansToDelete.length} orphan(s).`);
}

main().catch((err) => {
  console.error('[cleanup-orphan-r2-tiles] FAILED:', err);
  process.exit(1);
});
