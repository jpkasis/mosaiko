// @vitest-environment jsdom
/**
 * Integrity test: single-photo rotation state machine (UAT-6 PR5)
 *
 * The client request was literal — "rotate the PHOTO, not the mosaic".
 * `useBuilderFlow` owns the single-photo `imageRotation` state and the
 * `toggleImageRotation` action. This pins the two behaviours the print
 * pipeline depends on:
 *
 *   1. Toggling cycles 0 → 90 → 180 → 270 → 0 (the four quarter-turns the
 *      Sharp `cropAndResize` rotation option supports — see
 *      `whitelistImageRotation`).
 *   2. Toggling CLEARS the stale crop areas. react-easy-crop emits crop
 *      coordinates in the rotated frame, so a crop captured before the
 *      turn is meaningless after it — the cropper must re-emit. If the
 *      old crop survived, checkout would print the wrong region.
 *
 * Plus: rotation resets to 0 on every path that swaps the photo or the
 * grid (new photo, replace, grid change, full reset) so a leftover angle
 * never leaks onto an unrelated image.
 *
 * Component-level concerns (the toolbar button, passing `rotation` to
 * <Cropper>, the stretch-bounds W/H swap) are validated end-to-end by
 * `processor-contract.test.ts` (swapped bounds → correct rotated print)
 * and are not re-rendered here — react-easy-crop needs real layout
 * measurement that jsdom doesn't provide.
 */
import { describe, test, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useBuilderFlow } from '@/components/builder/useBuilderFlow';
import type { CropArea } from '@/lib/canvas-utils';

const CROP_A: CropArea = { x: 10, y: 20, width: 300, height: 300 };
const CROP_LIVE: CropArea = { x: 11, y: 21, width: 301, height: 301 };

/** Drive the hook into a "photo cropped" state for a single-photo category. */
function seedCroppedState(result: { current: ReturnType<typeof useBuilderFlow> }) {
  act(() => {
    result.current.handleCropChange(CROP_LIVE);
    result.current.handleCropComplete(CROP_A, CROP_A);
  });
}

describe('useBuilderFlow — single-photo imageRotation (UAT-6 PR5)', () => {
  test('starts at 0', () => {
    const { result } = renderHook(() =>
      useBuilderFlow({ initialCategory: 'mosaicos', initialGrid: 9 }),
    );
    expect(result.current.imageRotation).toBe(0);
  });

  test('toggleImageRotation cycles 0 → 90 → 180 → 270 → 0', () => {
    const { result } = renderHook(() =>
      useBuilderFlow({ initialCategory: 'mosaicos', initialGrid: 9 }),
    );
    const seq: number[] = [];
    for (let i = 0; i < 4; i++) {
      act(() => result.current.toggleImageRotation());
      seq.push(result.current.imageRotation);
    }
    expect(seq).toEqual([90, 180, 270, 0]);
  });

  test('toggling clears the stale crop areas so the cropper re-emits', () => {
    const { result } = renderHook(() =>
      useBuilderFlow({ initialCategory: 'mosaicos', initialGrid: 9 }),
    );
    seedCroppedState(result);
    expect(result.current.cropAreaPixels).toEqual(CROP_A);
    expect(result.current.liveCropArea).toEqual(CROP_LIVE);

    act(() => result.current.toggleImageRotation());

    expect(result.current.imageRotation).toBe(90);
    expect(result.current.cropAreaPixels).toBeNull();
    expect(result.current.liveCropArea).toBeNull();
  });

  test('replacing the photo resets rotation to 0', () => {
    const { result } = renderHook(() =>
      useBuilderFlow({ initialCategory: 'mosaicos', initialGrid: 9 }),
    );
    act(() => result.current.toggleImageRotation());
    expect(result.current.imageRotation).toBe(90);

    act(() => result.current.handleReplaceSingleImage());
    expect(result.current.imageRotation).toBe(0);
  });

  test('changing the grid resets rotation to 0', () => {
    const { result } = renderHook(() =>
      useBuilderFlow({ initialCategory: 'mosaicos', initialGrid: 9 }),
    );
    act(() => result.current.toggleImageRotation());
    act(() => result.current.toggleImageRotation());
    expect(result.current.imageRotation).toBe(180);

    act(() => result.current.handleGridSelect(6));
    expect(result.current.imageRotation).toBe(0);
  });

  test('full reset clears rotation to 0', () => {
    const { result } = renderHook(() =>
      useBuilderFlow({ initialCategory: 'mosaicos', initialGrid: 9 }),
    );
    act(() => result.current.toggleImageRotation());
    expect(result.current.imageRotation).toBe(90);

    act(() => result.current.handleReset());
    expect(result.current.imageRotation).toBe(0);
  });
});
