/**
 * Integrity test: webhook order processing — failure modes + Phase 3
 * composite-reuse bypass.
 *
 * Both pipeline-audit BLOCKERs are FIXED:
 *   - BLOCKER #1 (webhook silent photo-fetch failure) — Phase 3 of the
 *     integrity audit. Tests under §"BLOCKER #1 — webhook photo-fetch
 *     silent drop (post-fix behaviour)" pin the typed `LineItemResult`
 *     contract and 7 distinct failure reasons.
 *   - BLOCKER #2 (R2 upload partial state) — Phase 4 of the integrity
 *     audit. Tests under §"Phase 4 fix" pin `Promise.allSettled` +
 *     `UploadFailure { succeeded, failed }` shape + per-line idempotency
 *     reuse/retry.
 *
 * Phase 3 (Appendix I) added composite-reuse bypass: when the cart
 * carries `_composite_key` + `_composite_pipeline_version`, the webhook
 * splits the stored composite into tiles instead of re-running the
 * Sharp processor. Tests under §"Phase 3.1 — composite-reuse bypass"
 * pin: happy path (every category), version mismatch fall-through,
 * untrusted-key rejection, dimension mismatch, Tonos-grid bypass,
 * server-derived URL (key/url binding).
 */
import { describe, test, expect, vi, afterEach } from 'vitest';

const SHOP_FILES_PREFIX = 'https://cdn.shopify.com/s/files/1/0984/4562/3587/files';

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  vi.doUnmock('@/lib/shopify/files');
});

// ─── Shopify Files mock factory ─────────────────────────────────────────────

/**
 * Mocks `@/lib/shopify/files` so `uploadPrintTiles` (in `@/lib/storage`)
 * talks to a deterministic batch fn. `batchImpl` receives the inputs
 * passed to `uploadShopifyFilesBatch` and returns the result array.
 * Reject the promise to simulate an atomic batch failure (which the
 * storage layer translates into an `UploadFailure` carrying every tile
 * in `failed`).
 */
function mockShopifyFiles(
  batchImpl: (
    inputs: Array<{ filename: string; mimeType: string; buffer: Buffer }>,
  ) => Promise<Array<{ id: string; url: string; filename: string }>>,
): {
  uploadShopifyFilesBatch: ReturnType<typeof vi.fn>;
  uploadShopifyFile: ReturnType<typeof vi.fn>;
} {
  const uploadShopifyFilesBatch = vi.fn(batchImpl);
  const uploadShopifyFile = vi.fn(
    async (
      filename: string,
      mimeType: string,
      buffer: Buffer,
    ) => {
      const [out] = await batchImpl([{ filename, mimeType, buffer }]);
      return out;
    },
  );
  vi.doMock('@/lib/shopify/files', () => ({
    uploadShopifyFilesBatch,
    uploadShopifyFile,
    findShopifyFileByFilename: vi.fn(async () => null),
    listShopifyFilesByPrefix: vi.fn(async () => []),
    deleteShopifyFileById: vi.fn(async () => undefined),
    deleteShopifyFileByFilename: vi.fn(async () => undefined),
    shopifyCdnUrlFilename: (url: string) => {
      try {
        const u = new URL(url);
        if (u.origin !== 'https://cdn.shopify.com') return null;
        const m = /^\/s\/files\/[^/]+(?:\/[^/]+){0,3}\/files\/([^/]+)$/.exec(u.pathname);
        if (!m) return null;
        return decodeURIComponent(m[1]);
      } catch {
        return null;
      }
    },
    SHOPIFY_FILE_MAX_BYTES: 15 * 1024 * 1024,
    SHOPIFY_IMAGE_MAX_PIXELS: 16_000_000,
    resizeForShopifyFiles: async (buf: Buffer) => buf,
    getAdminAccessToken: vi.fn(async () => 'shpat_test'),
    SHOPIFY_API_VERSION: '2026-04',
  }));
  return { uploadShopifyFilesBatch, uploadShopifyFile };
}

// ─── BLOCKER #2 — R2 partial state (FIXED in Phase 4) ──────────────────────

describe('BLOCKER #2 — uploadPrintTiles partial-state on tile failure', () => {
  // Phase 4 replaced the Promise.all first-rejection semantics with
  // Promise.allSettled + a structured UploadFailure throw. The pre-fix
  // "orphan risk" pin tests are no longer reachable (they relied on
  // early rejection). The Phase 4 assertions further below prove the
  // new contract.

  test('successful path still returns URLs keyed by tile index', async () => {
    mockShopifyFiles(async (inputs) =>
      inputs.map((i, idx) => ({
        id: `gid://shopify/MediaImage/${100 + idx}`,
        url: `${SHOP_FILES_PREFIX}/${i.filename}`,
        filename: i.filename,
      })),
    );

    const { uploadPrintTiles } = await import('@/lib/storage');

    const tiles = [
      { index: 0, buffer: Buffer.from('a') },
      { index: 1, buffer: Buffer.from('b') },
    ];

    const result = await uploadPrintTiles('order-Y-item-456', tiles);
    expect(result).toEqual([
      {
        key: 'mosaiko-order-Y-item-456-tile-0.png',
        publicUrl: `${SHOP_FILES_PREFIX}/mosaiko-order-Y-item-456-tile-0.png`,
      },
      {
        key: 'mosaiko-order-Y-item-456-tile-1.png',
        publicUrl: `${SHOP_FILES_PREFIX}/mosaiko-order-Y-item-456-tile-1.png`,
      },
    ]);
  });

  // ─── Phase 4: uploadPrintTiles surfaces structured UploadFailure ────────

  test('Phase 4 fix — any tile failure → UploadFailure (atomic batch semantics)', async () => {
    // Post-Shopify-Files migration the upload primitive is atomic: a
    // failure on any one input throws AFTER best-effort cleanup of the
    // others. The storage layer surfaces this as `UploadFailure` with
    // every input under `failed[]` (succeeded[] is empty). This is a
    // STRICTER all-or-nothing than the prior R2 partial-state contract;
    // it removes the orphan-tile concern by handling cleanup inside
    // the primitive rather than leaving it to the orchestrator.
    mockShopifyFiles(async (inputs) => {
      // Simulate Shopify Files batch failure when any tile-1 is in scope.
      if (inputs.some((i) => i.filename.includes('tile-1'))) {
        throw new Error('Shopify Files batch failed on tile-1');
      }
      return inputs.map((i, idx) => ({
        id: `gid://shopify/MediaImage/${100 + idx}`,
        url: `${SHOP_FILES_PREFIX}/${i.filename}`,
        filename: i.filename,
      }));
    });

    const { uploadPrintTiles, UploadFailure } = await import('@/lib/storage');

    try {
      await uploadPrintTiles('order-F-item-1', [
        { index: 0, buffer: Buffer.from('a') },
        { index: 1, buffer: Buffer.from('b') },
        { index: 2, buffer: Buffer.from('c') },
      ]);
      throw new Error('should have thrown UploadFailure');
    } catch (err) {
      expect(err).toBeInstanceOf(UploadFailure);
      if (err instanceof UploadFailure) {
        // Atomic: nothing succeeds; every tile is in `failed`.
        expect(err.succeeded).toHaveLength(0);
        expect(err.failed).toHaveLength(3);
        expect(err.failed.map((f) => f.index).sort()).toEqual([0, 1, 2]);
        expect(err.failed[0].reason).toMatch(/Shopify Files batch failed/);
      }
    }
  });

  test('Phase 4 fix — uploadPrintTiles full-success path still returns {key,publicUrl}[]', async () => {
    mockShopifyFiles(async (inputs) =>
      inputs.map((i, idx) => ({
        id: `gid://shopify/MediaImage/${200 + idx}`,
        url: `${SHOP_FILES_PREFIX}/${i.filename}`,
        filename: i.filename,
      })),
    );

    const { uploadPrintTiles } = await import('@/lib/storage');
    const result = await uploadPrintTiles('order-G-item-1', [
      { index: 0, buffer: Buffer.from('a') },
      { index: 1, buffer: Buffer.from('b') },
    ]);
    expect(result).toHaveLength(2);
    expect(result[0].key).toBe('mosaiko-order-G-item-1-tile-0.png');
  });

  // ─── Phase 4: per-line idempotency via `priors` ─────────────────────────

  test('Phase 4 fix — processWebhookOrder reuses prior successes without re-invoking deps', async () => {
    const { processWebhookOrder } = await import(
      '@/lib/shopify/webhook-processor'
    );

    let fetchCount = 0;
    let uploadCount = 0;

    const order = {
      id: 99,
      order_number: 303,
      name: '#303',
      email: 'c@x.com',
      line_items: [
        {
          id: 1,
          title: 'Already-done Mosaico',
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
              value: 'https://cdn.shopify.com/s/files/1/0984/4562/3587/files/mosaiko-uploads--done.jpg',
            },
            {
              name: '_crop_area',
              value: JSON.stringify({ x: 0, y: 0, width: 1, height: 1 }),
            },
          ],
        },
        {
          id: 2,
          title: 'Needs retry Mosaico',
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
              value: 'https://cdn.shopify.com/s/files/1/0984/4562/3587/files/mosaiko-uploads--retry.jpg',
            },
            {
              name: '_crop_area',
              value: JSON.stringify({ x: 0, y: 0, width: 1, height: 1 }),
            },
          ],
        },
      ],
    };

    const priors: PriorLineResult[] = [
      {
        lineItemId: 1,
        kind: 'ok',
        urls: [
          'https://cdn.shopify.com/s/files/1/0984/4562/3587/files/mosaiko-order-99-item-1-tile-0.png',
          'https://cdn.shopify.com/s/files/1/0984/4562/3587/files/mosaiko-order-99-item-1-tile-1.png',
        ],
      },
    ];

    const result = await processWebhookOrder(
      order,
      {
        fetchPhoto: async () => {
          fetchCount++;
          return Buffer.from('ok');
        },
        uploadPrintTiles: async (jobId, tiles) => {
          uploadCount++;
          return tiles.map((t) => ({
            key: `mosaiko-${jobId}-tile-${t.index}.png`,
            publicUrl: `https://cdn.shopify.com/s/files/1/0984/4562/3587/files/mosaiko-${jobId}-tile-${t.index}.png`,
          }));
        },
        processPrintJob: async () => ({
          tiles: [{ index: 0, buffer: Buffer.from('t'), filename: 't.png' }],
        }),
      },
      { priors },
    );

    expect(result.status).toBe('complete');
    // Line 1 was skipped entirely — no fetch, no upload happened for it.
    expect(fetchCount).toBe(1);
    expect(uploadCount).toBe(1);
    // But the reused URLs still appear in allUrls:
    expect(result.allUrls).toContain(
      'https://cdn.shopify.com/s/files/1/0984/4562/3587/files/mosaiko-order-99-item-1-tile-0.png',
    );
    expect(result.allUrls).toContain(
      'https://cdn.shopify.com/s/files/1/0984/4562/3587/files/mosaiko-order-99-item-1-tile-1.png',
    );
  });

  test('Phase 4 fix — prior failures are NOT reused; the line retries fresh', async () => {
    const { processWebhookOrder } = await import(
      '@/lib/shopify/webhook-processor'
    );

    let fetchCount = 0;

    const order = {
      id: 100,
      order_number: 404,
      name: '#404',
      email: 'c@x.com',
      line_items: [
        {
          id: 1,
          title: 'Previously failed',
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
              value: 'https://cdn.shopify.com/s/files/1/0984/4562/3587/files/mosaiko-uploads--once-broken.jpg',
            },
            {
              name: '_crop_area',
              value: JSON.stringify({ x: 0, y: 0, width: 1, height: 1 }),
            },
          ],
        },
      ],
    };

    const priors: PriorLineResult[] = [
      // A previous run marked this line failed; on retry the orchestrator
      // MUST re-process it, not reuse anything.
      {
        lineItemId: 1,
        kind: 'failed',
        reason: 'photo_fetch_failed',
      },
    ];

    const result = await processWebhookOrder(
      order,
      {
        fetchPhoto: async () => {
          fetchCount++;
          return Buffer.from('retry-succeeded');
        },
        uploadPrintTiles: async (jobId, tiles) =>
          tiles.map((t) => ({
            key: `${jobId}-tile-${t.index}.png`,
            publicUrl: `https://r2/${jobId}-tile-${t.index}.png`,
          })),
        processPrintJob: async () => ({
          tiles: [{ index: 0, buffer: Buffer.from('x'), filename: 'x.png' }],
        }),
      },
      { priors },
    );

    expect(fetchCount).toBe(1);
    expect(result.status).toBe('complete');
  });
});

// `PriorLineResult` type — imported for the test bodies above.
type PriorLineResult =
  import('@/lib/shopify/webhook-processor').PriorLineResult;

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
          _photo_url: 'https://cdn.shopify.com/s/files/1/0984/4562/3587/files/mosaiko-uploads--missing.jpg',
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
                value: 'https://cdn.shopify.com/s/files/1/0984/4562/3587/files/mosaiko-uploads--ok.jpg',
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
                value: 'https://cdn.shopify.com/s/files/1/0984/4562/3587/files/mosaiko-uploads--broken.jpg',
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
            key: `mosaiko-${jobId}-tile-${t.index}.png`,
            publicUrl: `https://cdn.shopify.com/s/files/1/0984/4562/3587/files/mosaiko-${jobId}-tile-${t.index}.png`,
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
                value: 'https://cdn.shopify.com/s/files/1/0984/4562/3587/files/mosaiko-uploads--x.jpg',
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
          _photo_url: 'https://cdn.shopify.com/s/files/1/0984/4562/3587/files/mosaiko-uploads--x.jpg',
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
          _photo_url: 'https://cdn.shopify.com/s/files/1/0984/4562/3587/files/mosaiko-uploads--x.jpg',
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

  test('processPrintJob returns 0 tiles → no_tiles_generated (not a silent "ok" with empty urls)', async () => {
    // Codex-identified bug: before adding the tile-count invariant,
    // any processor that produced zero tiles would result in
    // `kind: 'ok', urls: []`, the order would be marked 'complete',
    // and the admin email would happily confirm success with no
    // download link. Now we explicitly fail with no_tiles_generated.
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
          _photo_url: 'https://cdn.shopify.com/s/files/1/0984/4562/3587/files/mosaiko-uploads--x.jpg',
          _crop_area: JSON.stringify({ x: 0, y: 0, width: 1, height: 1 }),
        },
      },
      {
        fetchPhoto: async () => Buffer.from('ok'),
        uploadPrintTiles: async () => [],
        processPrintJob: async () => ({ tiles: [] }),
      },
    );
    expect(result.kind).toBe('failed');
    if (result.kind === 'failed') {
      expect(result.reason).toBe('no_tiles_generated');
    }
  });

  test('tonos fitMode whitelisted from tonosSlots → forwarded into processPrintJob (Phase 2)', async () => {
    const { processLineItem } = await import('@/lib/shopify/webhook-processor');

    // Capture the job argument the webhook hands to the print pipeline.
    let capturedJob: { rotations?: unknown; fitModes?: unknown } | null = null;
    const result = await processLineItem(
      1,
      {
        lineItemId: 99,
        title: 'Tonos 9 fitMode',
        quantity: 1,
        attrs: {
          _customization: JSON.stringify({
            categoryType: 'tonos',
            gridSize: 9,
            intensity: 'medium',
            tonosSlots: [
              { fitMode: 'fit', rotation: 0 },
              { fitMode: 'fill', rotation: 90 },
              { fitMode: 'stretch', rotation: 270 },
            ],
          }),
          _photo_urls: JSON.stringify([
            'https://cdn.shopify.com/s/files/1/0984/4562/3587/files/mosaiko-uploads--a.jpg',
            'https://cdn.shopify.com/s/files/1/0984/4562/3587/files/mosaiko-uploads--b.jpg',
            'https://cdn.shopify.com/s/files/1/0984/4562/3587/files/mosaiko-uploads--c.jpg',
          ]),
          _crop_areas: JSON.stringify([
            { x: 0, y: 0, width: 1, height: 1 },
            { x: 0, y: 0, width: 1, height: 1 },
            { x: 0, y: 0, width: 1, height: 1 },
          ]),
        },
      },
      {
        fetchPhoto: async () => Buffer.from('ok'),
        uploadPrintTiles: async () => [
          { key: 'k0', publicUrl: 'https://r2.mosaiko.mx/k0' },
        ],
        processPrintJob: async (job) => {
          capturedJob = job as { rotations?: unknown; fitModes?: unknown };
          return {
            tiles: [
              { index: 0, buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47]), filename: 'a' },
            ],
          };
        },
      },
    );
    expect(result.kind).toBe('ok');

    expect(capturedJob).not.toBeNull();
    // Whitelist preserved per-slot rotation AND fitMode in the same order.
    expect((capturedJob as unknown as { rotations: number[] }).rotations).toEqual([0, 90, 270]);
    expect((capturedJob as unknown as { fitModes: string[] }).fitModes).toEqual([
      'fit',
      'fill',
      'stretch',
    ]);
  });

  test('tonos malformed tonosSlots → fitModes undefined; processor falls back to "fill"', async () => {
    const { processLineItem } = await import('@/lib/shopify/webhook-processor');

    let capturedJob: { fitModes?: unknown } | null = null;
    const result = await processLineItem(
      2,
      {
        lineItemId: 100,
        title: 'Tonos 9 malformed',
        quantity: 1,
        attrs: {
          _customization: JSON.stringify({
            categoryType: 'tonos',
            gridSize: 9,
            intensity: 'medium',
            // Wrong shape: only 2 slots — whitelist must reject and pass undefined.
            tonosSlots: [{ fitMode: 'fit', rotation: 0 }, { fitMode: 'fill', rotation: 0 }],
          }),
          _photo_urls: JSON.stringify([
            'https://cdn.shopify.com/s/files/1/0984/4562/3587/files/mosaiko-uploads--a.jpg',
            'https://cdn.shopify.com/s/files/1/0984/4562/3587/files/mosaiko-uploads--b.jpg',
            'https://cdn.shopify.com/s/files/1/0984/4562/3587/files/mosaiko-uploads--c.jpg',
          ]),
          _crop_areas: JSON.stringify([
            { x: 0, y: 0, width: 1, height: 1 },
            { x: 0, y: 0, width: 1, height: 1 },
            { x: 0, y: 0, width: 1, height: 1 },
          ]),
        },
      },
      {
        fetchPhoto: async () => Buffer.from('ok'),
        uploadPrintTiles: async () => [
          { key: 'k0', publicUrl: 'https://r2.mosaiko.mx/k0' },
        ],
        processPrintJob: async (job) => {
          capturedJob = job as { fitModes?: unknown };
          return {
            tiles: [
              { index: 0, buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47]), filename: 'a' },
            ],
          };
        },
      },
    );
    expect(result.kind).toBe('ok');
    expect(capturedJob).not.toBeNull();
    // Whitelist returns undefined when shape is wrong — processor defaults to 'fill'.
    expect((capturedJob as unknown as { fitModes: unknown }).fitModes).toBeUndefined();
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
            'https://cdn.shopify.com/s/files/1/0984/4562/3587/files/mosaiko-uploads--a.jpg',
            'https://cdn.shopify.com/s/files/1/0984/4562/3587/files/mosaiko-uploads--b.jpg',
            'https://cdn.shopify.com/s/files/1/0984/4562/3587/files/mosaiko-uploads--c.jpg',
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

// ─── Phase 3.1 — Composite-reuse bypass (FIXED, was MAJOR #9) ───────────────

/**
 * Phase 3 wired the cart-composite path: when a cart line carries a
 * pre-rendered composite (`_composite_key` + `_composite_url` +
 * `_composite_pipeline_version`), the webhook splits it into tiles via
 * `splitCompositeIntoTiles` instead of re-running the Sharp processor.
 *
 * These tests pin every gate of the bypass with mocked `processPrintJob`
 * that throws-if-called — proving the bypass actually skipped it on the
 * happy path, and was correctly rejected (fall-through to processPrintJob)
 * for the version-mismatch and untrusted-key cases.
 */
describe('Phase 3.1 — composite-reuse bypass', () => {
  // Build a real composite buffer at the dimensions a mosaicos 3-grid
  // (1×3 tiles, each 827×827) would produce. Sharp's `extract` validates
  // input is a real PNG, so we must use a valid encode here — not a
  // synthetic byte buffer.
  async function buildMosaicos3Composite(): Promise<Buffer> {
    const sharp = (await import('sharp')).default;
    return sharp({
      create: {
        width: 3 * 827,
        height: 1 * 827,
        channels: 3,
        background: { r: 30, g: 200, b: 220 },
      },
    })
      .png()
      .toBuffer();
  }

  test('happy path: valid composite + matching version → bypass; processPrintJob NOT called', async () => {
    const composite = await buildMosaicos3Composite();
    const { PIPELINE_VERSION } = await import('@/lib/print-pipeline/version');
    const { processLineItem } = await import('@/lib/shopify/webhook-processor');

    const processPrintJobSpy = vi.fn(async () => {
      throw new Error('processPrintJob should NOT be called when bypass succeeds');
    });
    const uploadPrintTilesSpy = vi.fn(
      async (jobId: string, tiles: { index: number; buffer: Buffer }[]) =>
        tiles.map((t) => ({
          key: `mosaiko-${jobId}-tile-${t.index}.png`,
          publicUrl: `https://cdn.shopify.com/s/files/1/0984/4562/3587/files/mosaiko-${jobId}-tile-${t.index}.png`,
        })),
    );
    const deleteCompositeSpy = vi.fn(async () => {});

    const result = await processLineItem(
      42,
      {
        lineItemId: 7,
        title: 'Mosaico 3 (composite-reused)',
        quantity: 1,
        attrs: {
          _customization: JSON.stringify({
            categoryType: 'mosaicos',
            gridSize: 3,
          }),
          _photo_url: 'https://cdn.shopify.com/s/files/1/0984/4562/3587/files/mosaiko-uploads--x.jpg',
          _crop_area: JSON.stringify({ x: 0, y: 0, width: 1, height: 1 }),
          _composite_key: 'mosaiko-print-files--cart-composites-abc-123.png',
          _composite_url:
            'https://cdn.shopify.com/s/files/1/0984/4562/3587/files/mosaiko-print-files--cart-composites-abc-123.png',
          _composite_pipeline_version: PIPELINE_VERSION,
        },
      },
      {
        // fetchPhoto is invoked once for the composite URL, not for the
        // original photo — the bypass path uses fetchPhoto for both.
        fetchPhoto: async () => composite,
        uploadPrintTiles: uploadPrintTilesSpy,
        processPrintJob: processPrintJobSpy,
        deleteComposite: deleteCompositeSpy,
      },
    );

    expect(result.kind).toBe('ok');
    expect(processPrintJobSpy).not.toHaveBeenCalled();
    // Mosaicos 3-grid → 3 tiles uploaded.
    expect(uploadPrintTilesSpy).toHaveBeenCalledTimes(1);
    expect(uploadPrintTilesSpy.mock.calls[0][1]).toHaveLength(3);
    // Cleanup ran (best-effort, non-fatal — we just confirm the call).
    expect(deleteCompositeSpy).toHaveBeenCalledWith(
      'mosaiko-print-files--cart-composites-abc-123.png',
    );
  });

  test('pipeline-version mismatch → bypass falls through; processPrintJob IS called', async () => {
    const composite = await buildMosaicos3Composite();
    const { processLineItem } = await import('@/lib/shopify/webhook-processor');

    const processPrintJobSpy = vi.fn(async (job: unknown) => ({
      tiles: [
        {
          index: 0,
          buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
          filename: 't0',
        },
      ],
      job,
    }));

    const result = await processLineItem(
      43,
      {
        lineItemId: 8,
        title: 'Mosaico 3 (stale composite)',
        quantity: 1,
        attrs: {
          _customization: JSON.stringify({
            categoryType: 'mosaicos',
            gridSize: 3,
          }),
          _photo_url: 'https://cdn.shopify.com/s/files/1/0984/4562/3587/files/mosaiko-uploads--x.jpg',
          _crop_area: JSON.stringify({ x: 0, y: 0, width: 1, height: 1 }),
          _composite_key: 'mosaiko-print-files--cart-composites-abc-456.png',
          _composite_url:
            'https://cdn.shopify.com/s/files/1/0984/4562/3587/files/mosaiko-print-files--cart-composites-abc-456.png',
          // Deliberately stale version — should reject the bypass.
          _composite_pipeline_version: 'pre-phase-3-old-version',
        },
      },
      {
        fetchPhoto: async () => composite,
        uploadPrintTiles: async (jobId, tiles) =>
          tiles.map((t) => ({
            key: `k${t.index}`,
            publicUrl: `https://r2.test/${jobId}/${t.index}`,
          })),
        processPrintJob: processPrintJobSpy,
      },
    );

    expect(result.kind).toBe('ok');
    expect(processPrintJobSpy).toHaveBeenCalledTimes(1);
  });

  test('untrusted _composite_key (wrong prefix) → bypass falls through; processPrintJob IS called', async () => {
    const { PIPELINE_VERSION } = await import('@/lib/print-pipeline/version');
    const { processLineItem } = await import('@/lib/shopify/webhook-processor');

    const processPrintJobSpy = vi.fn(async () => ({
      tiles: [
        {
          index: 0,
          buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
          filename: 't0',
        },
      ],
    }));
    // fetchPhoto should not be called for the composite (key was rejected
    // before fetch); will be called for the original photo path though,
    // which is mocked to return a tiny buffer the processor stub ignores.
    const fetchPhotoSpy = vi.fn(async () => Buffer.from('x'));

    const result = await processLineItem(
      44,
      {
        lineItemId: 9,
        title: 'Mosaico 3 (tampered key)',
        quantity: 1,
        attrs: {
          _customization: JSON.stringify({
            categoryType: 'mosaicos',
            gridSize: 3,
          }),
          _photo_url: 'https://cdn.shopify.com/s/files/1/0984/4562/3587/files/mosaiko-uploads--x.jpg',
          _crop_area: JSON.stringify({ x: 0, y: 0, width: 1, height: 1 }),
          // Path-traversal-style attack; regex requires the flattened
          // `mosaiko-print-files--cart-composites-<id>.png` shape.
          _composite_key: '../../../etc/passwd',
          _composite_url:
            'https://cdn.shopify.com/s/files/1/0984/4562/3587/files/mosaiko-print-files--cart-composites-anywhere.png',
          _composite_pipeline_version: PIPELINE_VERSION,
        },
      },
      {
        fetchPhoto: fetchPhotoSpy,
        uploadPrintTiles: async () => [
          { key: 'k0', publicUrl: 'https://r2.test/k0' },
        ],
        processPrintJob: processPrintJobSpy,
      },
    );

    expect(result.kind).toBe('ok');
    expect(processPrintJobSpy).toHaveBeenCalledTimes(1);
    // fetchPhoto called once — for the original photo only, NOT the composite.
    // (The composite-key gate rejected before fetch.)
    expect(fetchPhotoSpy).toHaveBeenCalledTimes(1);
    expect(fetchPhotoSpy).toHaveBeenCalledWith('https://cdn.shopify.com/s/files/1/0984/4562/3587/files/mosaiko-uploads--x.jpg');
  });

  test('Tonos 9-grid composite bypass: same path works for tone+logo-baked composites', async () => {
    const sharp = (await import('sharp')).default;
    // Tonos 9-grid → 3 rows × 3 cols × 827 = 2481×2481.
    const composite = await sharp({
      create: {
        width: 3 * 827,
        height: 3 * 827,
        channels: 3,
        background: { r: 220, g: 30, b: 30 },
      },
    })
      .png()
      .toBuffer();

    const { PIPELINE_VERSION } = await import('@/lib/print-pipeline/version');
    const { processLineItem } = await import('@/lib/shopify/webhook-processor');

    const processPrintJobSpy = vi.fn(async () => {
      throw new Error('processPrintJob should NOT be called for Tonos bypass');
    });
    const uploadPrintTilesSpy = vi.fn(
      async (jobId: string, tiles: { index: number; buffer: Buffer }[]) =>
        tiles.map((t) => ({
          key: `mosaiko-${jobId}-tile-${t.index}.png`,
          publicUrl: `https://cdn.shopify.com/s/files/1/0984/4562/3587/files/mosaiko-${jobId}-tile-${t.index}.png`,
        })),
    );

    const result = await processLineItem(
      46,
      {
        lineItemId: 11,
        title: 'Tonos 9 (composite-reused)',
        quantity: 1,
        attrs: {
          _customization: JSON.stringify({
            categoryType: 'tonos',
            gridSize: 9,
            intensity: 'medium',
          }),
          _photo_urls: JSON.stringify([
            'https://cdn.shopify.com/s/files/1/0984/4562/3587/files/mosaiko-uploads--a.jpg',
            'https://cdn.shopify.com/s/files/1/0984/4562/3587/files/mosaiko-uploads--b.jpg',
            'https://cdn.shopify.com/s/files/1/0984/4562/3587/files/mosaiko-uploads--c.jpg',
          ]),
          _crop_areas: JSON.stringify([
            { x: 0, y: 0, width: 1, height: 1 },
            { x: 0, y: 0, width: 1, height: 1 },
            { x: 0, y: 0, width: 1, height: 1 },
          ]),
          _composite_key: 'mosaiko-print-files--cart-composites-tonos-abc.png',
          _composite_url:
            'https://cdn.shopify.com/s/files/1/0984/4562/3587/files/mosaiko-print-files--cart-composites-tonos-abc.png',
          _composite_pipeline_version: PIPELINE_VERSION,
        },
      },
      {
        fetchPhoto: async () => composite,
        uploadPrintTiles: uploadPrintTilesSpy,
        processPrintJob: processPrintJobSpy,
      },
    );

    expect(result.kind).toBe('ok');
    expect(processPrintJobSpy).not.toHaveBeenCalled();
    // Tonos 9-grid → 9 tiles uploaded.
    expect(uploadPrintTilesSpy.mock.calls[0][1]).toHaveLength(9);
  });

  test('_composite_url must BIND to _composite_key (post-Shopify-Files Codex fix)', async () => {
    // Post-migration there is no deterministic key→URL mapping, so the
    // webhook must trust `_composite_url` — but ONLY after binding it
    // to `_composite_key` via the cdn.shopify.com URL filename. A
    // tampered cart that pairs a legitimate key with an attacker URL
    // (different filename) MUST cause the bypass to fall through.
    const composite = await buildMosaicos3Composite();
    const { PIPELINE_VERSION } = await import('@/lib/print-pipeline/version');
    const { processLineItem } = await import('@/lib/shopify/webhook-processor');

    const fetchPhotoSpy = vi.fn(async (_url: string) => composite);
    const processPrintJobSpy = vi.fn(async () => ({
      tiles: [
        { index: 0, buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47]), filename: 't0' },
      ],
    }));

    await processLineItem(
      47,
      {
        lineItemId: 12,
        title: 'Mosaico 3 (key/url mismatch)',
        quantity: 1,
        attrs: {
          _customization: JSON.stringify({
            categoryType: 'mosaicos',
            gridSize: 3,
          }),
          _photo_url:
            'https://cdn.shopify.com/s/files/1/0984/4562/3587/files/mosaiko-uploads--x.jpg',
          _crop_area: JSON.stringify({ x: 0, y: 0, width: 1, height: 1 }),
          _composite_key: 'mosaiko-print-files--cart-composites-legitimate.png',
          // Same-host URL but the FILENAME does not match the key — the
          // bind check must reject and we should fall through to the
          // full pipeline.
          _composite_url:
            'https://cdn.shopify.com/s/files/1/0984/4562/3587/files/mosaiko-print-files--cart-composites-attacker-controlled.png',
          _composite_pipeline_version: PIPELINE_VERSION,
        },
      },
      {
        fetchPhoto: fetchPhotoSpy,
        uploadPrintTiles: async (jobId, tiles) =>
          tiles.map((t) => ({
            key: `mosaiko-${jobId}-tile-${t.index}.png`,
            publicUrl: `${SHOP_FILES_PREFIX}/mosaiko-${jobId}-tile-${t.index}.png`,
          })),
        processPrintJob: processPrintJobSpy,
      },
    );

    // The bypass must have been rejected (key/url mismatch), so the
    // FULL pipeline ran via processPrintJob.
    expect(processPrintJobSpy).toHaveBeenCalledTimes(1);
    // fetchPhoto was called for the original photo, NOT for either
    // composite URL — we never reached the composite-fetch step.
    expect(fetchPhotoSpy.mock.calls.every((c) => !String(c[0]).includes('cart-composites'))).toBe(true);
  });

  test('composite dimension mismatch → bypass falls through; processPrintJob IS called', async () => {
    // Sharp create at WRONG dims for mosaicos-3 (expecting 2481×827).
    const sharp = (await import('sharp')).default;
    const wrongComposite = await sharp({
      create: {
        width: 1000,
        height: 1000,
        channels: 3,
        background: { r: 200, g: 80, b: 110 },
      },
    })
      .png()
      .toBuffer();

    const { PIPELINE_VERSION } = await import('@/lib/print-pipeline/version');
    const { processLineItem } = await import('@/lib/shopify/webhook-processor');

    const processPrintJobSpy = vi.fn(async () => ({
      tiles: [
        {
          index: 0,
          buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
          filename: 't0',
        },
      ],
    }));

    const result = await processLineItem(
      45,
      {
        lineItemId: 10,
        title: 'Mosaico 3 (mismatched composite dims)',
        quantity: 1,
        attrs: {
          _customization: JSON.stringify({
            categoryType: 'mosaicos',
            gridSize: 3,
          }),
          _photo_url: 'https://cdn.shopify.com/s/files/1/0984/4562/3587/files/mosaiko-uploads--x.jpg',
          _crop_area: JSON.stringify({ x: 0, y: 0, width: 1, height: 1 }),
          _composite_key: 'mosaiko-print-files--cart-composites-abc-789.png',
          _composite_url:
            'https://cdn.shopify.com/s/files/1/0984/4562/3587/files/mosaiko-print-files--cart-composites-abc-789.png',
          _composite_pipeline_version: PIPELINE_VERSION,
        },
      },
      {
        fetchPhoto: async () => wrongComposite,
        uploadPrintTiles: async () => [
          { key: 'k0', publicUrl: 'https://r2.test/k0' },
        ],
        processPrintJob: processPrintJobSpy,
      },
    );

    expect(result.kind).toBe('ok');
    expect(processPrintJobSpy).toHaveBeenCalledTimes(1);
  });
});
