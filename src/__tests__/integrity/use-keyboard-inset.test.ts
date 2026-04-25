// @vitest-environment jsdom
/**
 * Phase 6.1 — useKeyboardInset hook smoke test.
 *
 * Real-device verification (iOS Safari opening the soft keyboard) is
 * impossible without a device — this test proves the *wiring* is
 * correct: a fake `visualViewport` with addEventListener / resize /
 * removeEventListener is observed; firing a synthetic resize updates
 * the returned inset; unmounting removes the listener.
 *
 * The hook itself is ~30 lines and SSR-safe (no DOM access at module
 * load); the contract surface that needs guarding is the subscribe +
 * unsubscribe pair, not the math (innerHeight - viewport.height is
 * trivially correct).
 */
import { describe, test, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useKeyboardInset } from '@/components/builder/useKeyboardInset';

type ListenerSet = Set<() => void>;

function makeFakeViewport(initialHeight: number): {
  vp: VisualViewport;
  setHeight: (h: number) => void;
  hasListeners: () => boolean;
} {
  let height = initialHeight;
  const listeners: ListenerSet = new Set();
  const vp = {
    get height() {
      return height;
    },
    get width() {
      return 390;
    },
    addEventListener(_type: string, fn: () => void) {
      listeners.add(fn);
    },
    removeEventListener(_type: string, fn: () => void) {
      listeners.delete(fn);
    },
    dispatchEvent: () => true,
  } as unknown as VisualViewport;
  return {
    vp,
    setHeight(h: number) {
      height = h;
      for (const fn of listeners) fn();
    },
    hasListeners() {
      return listeners.size > 0;
    },
  };
}

describe('useKeyboardInset', () => {
  test('returns 0 when keyboard is closed (innerHeight === viewport.height)', () => {
    const fake = makeFakeViewport(844);
    Object.defineProperty(window, 'innerHeight', {
      configurable: true,
      value: 844,
    });
    const { result } = renderHook(() => useKeyboardInset(fake.vp));
    expect(result.current).toBe(0);
  });

  test('updates inset when viewport.height shrinks (keyboard opens)', () => {
    const fake = makeFakeViewport(844);
    Object.defineProperty(window, 'innerHeight', {
      configurable: true,
      value: 844,
    });
    const { result } = renderHook(() => useKeyboardInset(fake.vp));
    expect(result.current).toBe(0);

    // Keyboard pops up — visualViewport.height drops by ~340px.
    act(() => {
      fake.setHeight(504);
    });
    expect(result.current).toBe(340);
  });

  test('updates inset back to 0 when viewport.height returns (keyboard closes)', () => {
    const fake = makeFakeViewport(504);
    Object.defineProperty(window, 'innerHeight', {
      configurable: true,
      value: 844,
    });
    const { result } = renderHook(() => useKeyboardInset(fake.vp));
    expect(result.current).toBe(340);

    act(() => {
      fake.setHeight(844);
    });
    expect(result.current).toBe(0);
  });

  test('clamps to 0 when viewport.height > innerHeight (Safari quirk)', () => {
    // iOS Safari sometimes reports `visualViewport.height > window.innerHeight`
    // briefly during the keyboard close animation. Should NOT produce a
    // negative inset (would push the CTA below the viewport).
    const fake = makeFakeViewport(900);
    Object.defineProperty(window, 'innerHeight', {
      configurable: true,
      value: 844,
    });
    const { result } = renderHook(() => useKeyboardInset(fake.vp));
    expect(result.current).toBe(0);
  });

  test('cleanup unsubscribes the listener on unmount', () => {
    const fake = makeFakeViewport(844);
    Object.defineProperty(window, 'innerHeight', {
      configurable: true,
      value: 844,
    });
    const { unmount } = renderHook(() => useKeyboardInset(fake.vp));
    expect(fake.hasListeners()).toBe(true);
    unmount();
    expect(fake.hasListeners()).toBe(false);
  });

  test('returns 0 when viewport is null (older browsers / SSR)', () => {
    const { result } = renderHook(() => useKeyboardInset(null));
    expect(result.current).toBe(0);
  });

  test('does not throw when viewport is null on mount + unmount', () => {
    expect(() => {
      const { unmount } = renderHook(() => useKeyboardInset(null));
      unmount();
    }).not.toThrow();
  });
});
