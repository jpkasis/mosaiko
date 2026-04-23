/**
 * Integrity test: the two BLOCKER findings from the pipeline audit
 *
 * These tests pin the **current broken behaviour** so the test file
 * functions as a regression fence: before Phase 3/4 fixes land the
 * broken assertions must pass; after the fixes they get replaced with
 * the "fixed behaviour" assertions (currently expressed as `test.todo`).
 *
 * BLOCKER #1 — webhook swallows photo-fetch failure
 *   `src/app/api/webhooks/shopify/route.ts:233, 291, 368`
 *   On `fetchPhotoBuffer` returning null, `processLineItem` logs and
 *   returns `[]`. The webhook never marks the order "failed" — the
 *   admin email still fires with a download link that resolves to
 *   nothing, the order-level print_files metafield stays absent, and
 *   the route's own idempotency gate (metafield exists → skip) has
 *   no state to distinguish "not processed yet" from "processed and
 *   failed" — a legitimate retry is indistinguishable from a first
 *   run, so the same failure repeats silently.
 *
 *   Proper unit coverage requires extracting `processLineItem` into
 *   its own module (Phase 3's first step). Until then the finding
 *   is captured as `test.todo` so CI sees it.
 *
 * BLOCKER #2 — R2 upload partial-state on tile-upload failure
 *   `src/lib/storage.ts:120` uses `Promise.all` — on the first
 *   rejected tile, the whole promise rejects, but any tile that had
 *   already resolved has already written to R2. Those tiles are
 *   orphaned: no URL set in the metafield (the whole throw aborts
 *   the upstream push), no cleanup, no retry signal.
 *
 *   The order-level idempotency gate (metafield check) then flips:
 *   on retry, either (a) no tiles at all were written — the gate is
 *   empty and retry proceeds, OR (b) a prior *partial* run wrote
 *   the metafield with partial URLs — the gate fires "already
 *   processed, skip" and the missing tiles never get regenerated.
 *
 *   These tests assert `Promise.all` semantics directly against the
 *   exported `uploadPrintTiles` with a mocked S3 send.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Env prep — uploadPrintTiles reads these at call time ───────────────────

beforeEach(() => {
  process.env.R2_ACCOUNT_ID = 'test-account';
  process.env.R2_ACCESS_KEY_ID = 'test-key';
  process.env.R2_SECRET_ACCESS_KEY = 'test-secret';
  process.env.R2_BUCKET_PRINT_FILES = 'test-print-files';
  process.env.R2_PUBLIC_URL = 'https://r2.test.mosaiko.mx';
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  vi.doUnmock('@aws-sdk/client-s3');
});

// ─── S3 Client mock factory ─────────────────────────────────────────────────

/**
 * Mocks `@aws-sdk/client-s3` so `uploadPrintTiles` talks to a
 * deterministic send fn. `sendImpl` receives the command and returns a
 * promise — reject it to simulate upload failure for that tile.
 */
function mockS3Client(sendImpl: (command: unknown) => Promise<unknown>): {
  S3Client: new () => { send: typeof sendImpl };
  sendSpy: ReturnType<typeof vi.fn>;
} {
  const sendSpy = vi.fn(sendImpl);
  class FakeS3Client {
    send = sendSpy;
  }
  return { S3Client: FakeS3Client, sendSpy };
}

// ─── BLOCKER #2 — R2 partial state on Promise.all rejection ─────────────────

describe('BLOCKER #2 — uploadPrintTiles partial-state on tile failure', () => {
  /**
   * Today's behaviour: `Promise.all` on per-tile PutObjectCommand calls.
   * First rejection aborts; already-resolved tiles have written to R2.
   * The caller sees a throw — no signal about *which* tiles orphaned.
   */
  test('current behaviour — first rejection throws; upstream sees no partial info', async () => {
    // Simulate: tile 0 succeeds, tile 1 fails, tile 2 would succeed but
    // the caller's throw is thrown before it matters.
    const { S3Client, sendSpy } = mockS3Client(async (command) => {
      // Grab the key so we can distinguish which tile is sending.
      const cmd = command as { input?: { Key?: string } };
      const key = cmd.input?.Key ?? '';
      if (key.includes('tile-1')) {
        throw new Error('R2 timeout on tile-1');
      }
      // simulate latency so tile 0 wins the race before tile 2 runs
      return new Promise((resolve) => setTimeout(resolve, 0));
    });

    vi.doMock('@aws-sdk/client-s3', () => ({
      S3Client,
      PutObjectCommand: class {
        input: unknown;
        constructor(input: unknown) {
          this.input = input;
        }
      },
      GetObjectCommand: class {},
      DeleteObjectCommand: class {},
      ListObjectsV2Command: class {},
      CopyObjectCommand: class {},
    }));

    const { uploadPrintTiles } = await import('@/lib/storage');

    const tiles = [
      { index: 0, buffer: Buffer.from('zero') },
      { index: 1, buffer: Buffer.from('one') },
      { index: 2, buffer: Buffer.from('two') },
    ];

    // Promise.all rejects on first failure — caller gets a generic Error
    // with no structured UploadFailure surface.
    await expect(
      uploadPrintTiles('order-X-item-123', tiles),
    ).rejects.toThrow(/R2 timeout/);

    // The orphan risk: at least tile-0 had its PutObjectCommand dispatched.
    // Inspect the send calls to confirm it.
    const dispatchedKeys = sendSpy.mock.calls
      .map((call) => (call[0] as { input?: { Key?: string } }).input?.Key)
      .filter((k): k is string => typeof k === 'string');
    expect(dispatchedKeys).toContain('print-files/order-X-item-123/tile-0.png');
    expect(dispatchedKeys).toContain('print-files/order-X-item-123/tile-1.png');
    // tile-0's write has "left the building" before tile-1's rejection
    // aborts the gather — this is the orphan. Production sees this as
    // garbage R2 objects that are never referenced by any metafield.
  });

  test('current behaviour — successful path returns URLs keyed by tile index', async () => {
    const { S3Client } = mockS3Client(async () => ({}));

    vi.doMock('@aws-sdk/client-s3', () => ({
      S3Client,
      PutObjectCommand: class {
        input: unknown;
        constructor(input: unknown) {
          this.input = input;
        }
      },
      GetObjectCommand: class {},
      DeleteObjectCommand: class {},
      ListObjectsV2Command: class {},
      CopyObjectCommand: class {},
    }));

    const { uploadPrintTiles } = await import('@/lib/storage');

    const tiles = [
      { index: 0, buffer: Buffer.from('a') },
      { index: 1, buffer: Buffer.from('b') },
    ];

    const result = await uploadPrintTiles('order-Y-item-456', tiles);
    expect(result).toEqual([
      {
        key: 'print-files/order-Y-item-456/tile-0.png',
        publicUrl:
          'https://r2.test.mosaiko.mx/print-files/order-Y-item-456/tile-0.png',
      },
      {
        key: 'print-files/order-Y-item-456/tile-1.png',
        publicUrl:
          'https://r2.test.mosaiko.mx/print-files/order-Y-item-456/tile-1.png',
      },
    ]);
  });

  test('current behaviour — orphan risk is real: a late-resolving tile DOES write after the reject', async () => {
    // Proves durable partial success, not just dispatch.
    //
    // Setup: tile-1 rejects immediately. tile-0 and tile-2 use deferred
    // promises whose resolvers we hold — we release them AFTER the
    // Promise.all has rejected. Each resolver call is tracked so we
    // can assert it actually executed, meaning in production the R2
    // PUT completed but no URL reached the caller. That's the orphan.
    const resolvedKeys: string[] = [];
    const deferred: Record<string, (value: unknown) => void> = {};

    const { S3Client, sendSpy } = mockS3Client(async (command) => {
      const cmd = command as { input?: { Key?: string } };
      const key = cmd.input?.Key ?? '';
      if (key.includes('tile-1')) {
        throw new Error('R2 write failed on tile-1');
      }
      return new Promise((resolve) => {
        deferred[key] = (v) => {
          resolvedKeys.push(key);
          resolve(v);
        };
      });
    });

    vi.doMock('@aws-sdk/client-s3', () => ({
      S3Client,
      PutObjectCommand: class {
        input: unknown;
        constructor(input: unknown) {
          this.input = input;
        }
      },
      GetObjectCommand: class {},
      DeleteObjectCommand: class {},
      ListObjectsV2Command: class {},
      CopyObjectCommand: class {},
    }));

    const { uploadPrintTiles } = await import('@/lib/storage');

    const uploadPromise = uploadPrintTiles('order-Z-item-789', [
      { index: 0, buffer: Buffer.from('a') },
      { index: 1, buffer: Buffer.from('b') },
      { index: 2, buffer: Buffer.from('c') },
    ]);

    let caughtError: unknown = null;
    try {
      await uploadPromise;
    } catch (e) {
      caughtError = e;
    }

    expect(caughtError).toBeInstanceOf(Error);
    expect((caughtError as Error).message).toMatch(/tile-1/);
    // No structured failure information:
    expect(
      (caughtError as { failedIndexes?: number[] }).failedIndexes,
    ).toBeUndefined();
    expect(
      (caughtError as { succeeded?: unknown[] }).succeeded,
    ).toBeUndefined();

    // Now release the pending uploads: in production these are in-flight
    // S3 PUTs that complete server-side regardless of whether the caller
    // is still waiting. Simulate that by resolving them.
    const pendingKeys = Object.keys(deferred);
    expect(pendingKeys.length).toBeGreaterThanOrEqual(1);
    for (const k of pendingKeys) deferred[k]({});

    // Yield to the microtask queue so resolvedKeys fills.
    await new Promise((r) => setImmediate(r));

    // At least one tile actually wrote to R2 AFTER the caller had
    // already seen the reject — it's orphaned. No URL set in the
    // metafield, no cleanup signal, no retry affordance.
    expect(resolvedKeys.length).toBeGreaterThanOrEqual(1);
    // Dispatch was broad enough to produce the orphan:
    expect(sendSpy).toHaveBeenCalled();
  });

  // ─── AFTER Phase 4 fix — flip these todos to real tests ─────────────────

  test.todo(
    'BLOCKER-fix-TODO (Phase 4): uploadPrintTiles throws UploadFailure ' +
      'with { succeeded: {index,key}[]; failed: {index,reason}[] } so ' +
      'the caller can clean up orphans and retry just the failed tiles',
  );

  test.todo(
    'BLOCKER-fix-TODO (Phase 4): no partial URL set is written to the ' +
      'order metafield — the metafield is either complete or absent, ' +
      'never half-populated',
  );

  test.todo(
    'BLOCKER-fix-TODO (Phase 4): per-line-item idempotency key ' +
      '`${orderId}:${lineItemId}:v1` — completed lines are skipped on ' +
      'retry, failed lines are retried. Not one-bit-per-order.',
  );
});

// ─── BLOCKER #1 — photo-fetch silent drop in webhook (FIXED in Phase 3) ─────

describe('BLOCKER #1 — webhook photo-fetch silent drop (post-fix behaviour)', () => {
  // Phase 3 extracted the per-line-item processor into
  // `src/lib/shopify/webhook-processor.ts` with dependency injection
  // and a typed result. These tests assert the new contract directly
  // against that module — no env-var setup, no Next.js boot, no real
  // network calls.

  test('photo-fetch failure returns a typed LineItemFailed, not empty-array', async () => {
    const { processLineItem } = await import('@/lib/shopify/webhook-processor');

    const result = await processLineItem(
      42,
      {
        lineItemId: 100,
        title: 'Mosaico 9',
        quantity: 1,
        attrs: {
          _customization: JSON.stringify({
            categoryType: 'mosaicos',
            gridSize: 9,
          }),
          _photo_url: 'https://r2.mosaiko.mx/uploads/missing.jpg',
          _crop_area: JSON.stringify({ x: 0, y: 0, width: 1, height: 1 }),
        },
      },
      {
        fetchPhoto: async () => null, // simulate: all fetches fail
        uploadPrintTiles: async () => {
          throw new Error('should not be reached');
        },
        processPrintJob: async () => {
          throw new Error('should not be reached');
        },
      },
    );

    expect(result.kind).toBe('failed');
    if (result.kind === 'failed') {
      expect(result.reason).toBe('photo_fetch_failed');
      expect(result.lineItemId).toBe(100);
      expect(result.title).toBe('Mosaico 9');
    }
  });

  test('mixed order: one photo-fetch fails, another succeeds → status=partial, failures enumerated', async () => {
    const { processWebhookOrder } = await import(
      '@/lib/shopify/webhook-processor'
    );

    const result = await processWebhookOrder(
      {
        id: 77,
        order_number: 101,
        name: '#101',
        email: 'c@x.com',
        line_items: [
          {
            id: 1,
            title: 'Mosaico A',
            quantity: 1,
            variant_id: 11,
            properties: [
              {
                name: '_customization',
                value: JSON.stringify({
                  categoryType: 'mosaicos',
                  gridSize: 9,
                }),
              },
              {
                name: '_photo_url',
                value: 'https://r2.mosaiko.mx/uploads/ok.jpg',
              },
              {
                name: '_crop_area',
                value: JSON.stringify({ x: 0, y: 0, width: 1, height: 1 }),
              },
            ],
          },
          {
            id: 2,
            title: 'Mosaico B',
            quantity: 1,
            variant_id: 12,
            properties: [
              {
                name: '_customization',
                value: JSON.stringify({
                  categoryType: 'mosaicos',
                  gridSize: 9,
                }),
              },
              {
                name: '_photo_url',
                value: 'https://r2.mosaiko.mx/uploads/broken.jpg',
              },
              {
                name: '_crop_area',
                value: JSON.stringify({ x: 0, y: 0, width: 1, height: 1 }),
              },
            ],
          },
        ],
      },
      {
        fetchPhoto: async (url) =>
          url.includes('broken') ? null : Buffer.from('ok'),
        uploadPrintTiles: async (jobId, tiles) =>
          tiles.map((t) => ({
            key: `print-files/${jobId}/tile-${t.index}.png`,
            publicUrl: `https://r2.mosaiko.mx/print-files/${jobId}/tile-${t.index}.png`,
          })),
        processPrintJob: async () => ({
          tiles: [
            { index: 0, buffer: Buffer.from('t'), filename: 't0.png' },
            { index: 1, buffer: Buffer.from('t'), filename: 't1.png' },
          ],
        }),
      },
    );

    expect(result.status).toBe('partial');
    expect(result.results).toHaveLength(2);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].lineItemId).toBe(2);
    expect(result.failures[0].reason).toBe('photo_fetch_failed');
    // Successful line still contributes URLs — admin can retry just
    // the failed one.
    expect(result.allUrls.length).toBeGreaterThan(0);
    expect(result.allUrls.every((u) => u.includes('order-77-item-1'))).toBe(
      true,
    );
  });

  test('all-items-fail order → status=failed, no URLs, all failures enumerated', async () => {
    const { processWebhookOrder } = await import(
      '@/lib/shopify/webhook-processor'
    );

    const result = await processWebhookOrder(
      {
        id: 88,
        order_number: 102,
        name: '#102',
        email: 'c@x.com',
        line_items: [
          {
            id: 1,
            title: 'A',
            quantity: 1,
            variant_id: 1,
            properties: [
              {
                name: '_customization',
                value: JSON.stringify({
                  categoryType: 'mosaicos',
                  gridSize: 9,
                }),
              },
              {
                name: '_photo_url',
                value: 'https://r2.mosaiko.mx/uploads/x.jpg',
              },
              {
                name: '_crop_area',
                value: JSON.stringify({ x: 0, y: 0, width: 1, height: 1 }),
              },
            ],
          },
        ],
      },
      {
        fetchPhoto: async () => null,
        uploadPrintTiles: async () => [],
        processPrintJob: async () => ({ tiles: [] }),
      },
    );

    expect(result.status).toBe('failed');
    expect(result.allUrls).toEqual([]);
    expect(result.failures).toHaveLength(1);
  });

  test('malformed _customization JSON → customization_parse_error (not a crash)', async () => {
    const { processLineItem } = await import('@/lib/shopify/webhook-processor');
    const result = await processLineItem(
      1,
      {
        lineItemId: 1,
        title: 'X',
        quantity: 1,
        attrs: { _customization: '{not-json' },
      },
      {
        fetchPhoto: async () => null,
        uploadPrintTiles: async () => [],
        processPrintJob: async () => ({ tiles: [] }),
      },
    );
    expect(result.kind).toBe('failed');
    if (result.kind === 'failed') {
      expect(result.reason).toBe('customization_parse_error');
    }
  });

  test('print-pipeline throw → print_pipeline_error (error isolated to the line)', async () => {
    const { processLineItem } = await import('@/lib/shopify/webhook-processor');
    const result = await processLineItem(
      1,
      {
        lineItemId: 1,
        title: 'X',
        quantity: 1,
        attrs: {
          _customization: JSON.stringify({
            categoryType: 'mosaicos',
            gridSize: 9,
          }),
          _photo_url: 'https://r2.mosaiko.mx/uploads/x.jpg',
          _crop_area: JSON.stringify({ x: 0, y: 0, width: 1, height: 1 }),
        },
      },
      {
        fetchPhoto: async () => Buffer.from('ok'),
        uploadPrintTiles: async () => [],
        processPrintJob: async () => {
          throw new Error('hue=22.5 rejected by Sharp');
        },
      },
    );
    expect(result.kind).toBe('failed');
    if (result.kind === 'failed') {
      expect(result.reason).toBe('print_pipeline_error');
      expect(result.detail).toMatch(/22\.5/);
    }
  });

  test('tile-upload throw → tile_upload_error (kept distinct from pipeline errors)', async () => {
    const { processLineItem } = await import('@/lib/shopify/webhook-processor');
    const result = await processLineItem(
      1,
      {
        lineItemId: 1,
        title: 'X',
        quantity: 1,
        attrs: {
          _customization: JSON.stringify({
            categoryType: 'mosaicos',
            gridSize: 9,
          }),
          _photo_url: 'https://r2.mosaiko.mx/uploads/x.jpg',
          _crop_area: JSON.stringify({ x: 0, y: 0, width: 1, height: 1 }),
        },
      },
      {
        fetchPhoto: async () => Buffer.from('ok'),
        uploadPrintTiles: async () => {
          throw new Error('R2 quota exceeded');
        },
        processPrintJob: async () => ({
          tiles: [{ index: 0, buffer: Buffer.from('t'), filename: 't0.png' }],
        }),
      },
    );
    expect(result.kind).toBe('failed');
    if (result.kind === 'failed') {
      expect(result.reason).toBe('tile_upload_error');
    }
  });

  test('tonos partial photo-fetch → photo_fetch_failed with which slots', async () => {
    const { processLineItem } = await import('@/lib/shopify/webhook-processor');
    const result = await processLineItem(
      1,
      {
        lineItemId: 1,
        title: 'Tonos 9',
        quantity: 1,
        attrs: {
          _customization: JSON.stringify({
            categoryType: 'tonos',
            gridSize: 9,
            intensity: 'medium',
          }),
          _photo_urls: JSON.stringify([
            'https://r2.mosaiko.mx/uploads/a.jpg',
            'https://r2.mosaiko.mx/uploads/b.jpg',
            'https://r2.mosaiko.mx/uploads/c.jpg',
          ]),
          _crop_areas: JSON.stringify([
            { x: 0, y: 0, width: 1, height: 1 },
            { x: 0, y: 0, width: 1, height: 1 },
            { x: 0, y: 0, width: 1, height: 1 },
          ]),
        },
      },
      {
        fetchPhoto: async (url) =>
          url.includes('b.jpg') ? null : Buffer.from('ok'),
        uploadPrintTiles: async () => [],
        processPrintJob: async () => ({ tiles: [] }),
      },
    );
    expect(result.kind).toBe('failed');
    if (result.kind === 'failed') {
      expect(result.reason).toBe('photo_fetch_failed');
      // Detail names slot 1 (b.jpg is index 1).
      expect(result.detail).toBe('slots=1');
    }
  });
});
