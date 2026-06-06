// @vitest-environment jsdom
/**
 * PricesProvider live-refresh contract (price-bug fix).
 *
 * The storefront is statically rendered (next-intl setRequestLocale), so the
 * SSR seed can be a BUILD-TIME price. PricesProvider must fetch the live price
 * from /api/prices ON MOUNT, or an admin price change never shows in the store
 * until a redeploy.
 */
import { describe, test, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import React from 'react';
import { PricesProvider, usePrice } from '@/components/pricing/PricesProvider';

function Probe() {
  return <span data-testid="price">{usePrice('mosaicos', 3)}</span>;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('PricesProvider', () => {
  test('refreshes from /api/prices on mount (build-time seed → live price)', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ mosaicos: { 3: 250 } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    // Seeded with the stale build-time price ($200).
    render(
      <PricesProvider value={{ mosaicos: { 3: 200 } }}>
        <Probe />
      </PricesProvider>,
    );

    // After the mount refresh, it shows the live $250 from /api/prices.
    await waitFor(() => expect(screen.getByTestId('price').textContent).toBe('250'));
    expect(fetchMock).toHaveBeenCalledWith('/api/prices', expect.objectContaining({ cache: 'no-store' }));
  });

  test('keeps the seed if /api/prices fails (no crash)', async () => {
    global.fetch = vi.fn(async () => {
      throw new Error('network');
    }) as unknown as typeof fetch;

    render(
      <PricesProvider value={{ mosaicos: { 3: 200 } }}>
        <Probe />
      </PricesProvider>,
    );
    // Stays at the seed; no throw.
    await waitFor(() => expect(screen.getByTestId('price').textContent).toBe('200'));
  });
});
