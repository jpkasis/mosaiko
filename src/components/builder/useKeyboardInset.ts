'use client';

import { useEffect, useState } from 'react';

/**
 * Returns the current iOS soft-keyboard inset in pixels — the number
 * of pixels at the bottom of the viewport currently obscured by the
 * keyboard. 0 when the keyboard is closed (or the platform doesn't
 * have one — desktop, Android Chrome with a docked keyboard, etc.).
 *
 * Phase 6 (Appendix I) — wired into `MagnetBuilder`'s sticky CTA so
 * the footer rides above the keyboard on the customize step. Pre-fix,
 * focusing an STD/Arte/Studio text input pushed the keyboard over the
 * CTA and the user had to blur the input to reach it.
 *
 * Implementation:
 * - `window.visualViewport` is the iOS Safari / Android Chrome API for
 *   the visual (post-zoom, post-keyboard) viewport. Its `height` is
 *   smaller than `window.innerHeight` when the keyboard is visible.
 *   The difference IS the keyboard inset.
 * - Subscribes to `resize` events; updates state on every change.
 * - Returns 0 when `visualViewport` isn't available (older browsers,
 *   SSR) so callers don't need to special-case the absence.
 *
 * SSR-safe: defers all DOM access into the effect; initial render
 * always sees 0 so server + client markup match.
 *
 * Tested via fake viewport in `useKeyboardInset.test.ts`.
 */
export function useKeyboardInset(viewport: VisualViewport | null = typeof window !== 'undefined' ? window.visualViewport : null): number {
  const [inset, setInset] = useState(0);

  useEffect(() => {
    if (!viewport) return undefined;

    function recompute(): void {
      // typeof guard: tests pass a fake viewport with just height; in a
      // real browser `window.innerHeight` is reliable. Both branches
      // produce the same number when the keyboard is closed (inset 0).
      const innerH =
        typeof window !== 'undefined' ? window.innerHeight : viewport!.height;
      const next = Math.max(0, innerH - viewport!.height);
      setInset(next);
    }

    recompute();
    viewport.addEventListener('resize', recompute);
    return () => {
      viewport.removeEventListener('resize', recompute);
    };
  }, [viewport]);

  return inset;
}
