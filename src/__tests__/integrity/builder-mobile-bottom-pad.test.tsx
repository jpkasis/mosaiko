// @vitest-environment jsdom
/**
 * UAT-3 J12 (Codex audit finding) contract test, updated for UAT-6 PR6:
 *
 * On iOS Safari, when the soft keyboard opens, `useKeyboardInset` returns
 * the keyboard height, and the builder content's `paddingBottom` includes
 * that inset so the lower form area gains scroll-room above the keyboard.
 *
 * UAT-6 PR6 removed the floating sticky CTA from the customize step (lifted
 * above the keyboard it jittered and covered the fields). The customize CTA
 * is now an inline button at the END of the form. The bottom-padding
 * contract still holds — and is precisely what lets that inline button be
 * scrolled clear of the keyboard. (`mobileBottomPadStyle`'s else-branch,
 * taken when no sticky CTA is visible, still includes `keyboardInset`.)
 *
 * Contract: with `keyboardInset > 0`, the wrapping container's
 * `paddingBottom` MUST include the inset value in pixels.
 */
import { describe, test, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';

// ─── Hook + lib mocks ───────────────────────────────────────────────────────

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => ({ get: () => null }),
  useRouter: () => ({ push: () => {}, replace: () => {} }),
  usePathname: () => '/personalizar',
}));

function MockIntlLink({
  href,
  children,
  ...rest
}: {
  href: string | { pathname: string; query?: Record<string, string> };
  children?: React.ReactNode;
}) {
  const resolved =
    typeof href === 'string'
      ? href
      : `${href.pathname}?${new URLSearchParams(href.query ?? {}).toString()}`;
  return (
    <a data-href={resolved} {...rest}>
      {children}
    </a>
  );
}
MockIntlLink.displayName = 'MockIntlLink';
vi.mock('@/i18n/navigation', () => ({ Link: MockIntlLink }));

function MockDynamicNoop() {
  return null;
}
MockDynamicNoop.displayName = 'MockDynamicNoop';
vi.mock('next/dynamic', () => ({ default: () => MockDynamicNoop }));

vi.mock('framer-motion', () => {
  const tag = (Component: string) => {
    const Wrapped = ({
      children,
      ...rest
    }: { children?: React.ReactNode } & Record<string, unknown>) =>
      React.createElement(Component, rest, children);
    Wrapped.displayName = `MockMotion(${Component})`;
    return Wrapped;
  };
  function MockAnimatePresence({ children }: { children: React.ReactNode }) {
    return <>{children}</>;
  }
  MockAnimatePresence.displayName = 'MockAnimatePresence';
  return {
    motion: new Proxy({}, { get: (_t, name: string) => tag(name) }),
    AnimatePresence: MockAnimatePresence,
    useInView: () => true,
  };
});

vi.mock('@/lib/cart-store', () => ({
  useCartStore: () => () => undefined,
}));

// THE KEY MOCK for this test: return a non-zero inset so we can assert
// the wiring flows into mobileBottomPadStyle.
const KEYBOARD_INSET_PX = 280;
vi.mock('@/components/builder/useKeyboardInset', () => ({
  useKeyboardInset: () => KEYBOARD_INSET_PX,
}));

vi.mock('@/components/builder/useBuilderFlow', () => {
  const stepSequence = [
    'category',
    'grid',
    'upload',
    'crop',
    'customize',
    'preview',
  ];
  const STEP_I18N_MAP = {
    category: 'stepCategory',
    grid: 'stepGrid',
    upload: 'stepUpload',
    crop: 'stepCrop',
    customize: 'stepCustomize',
    preview: 'stepPreview',
  };
  return {
    STEP_I18N_MAP,
    useBuilderFlow: () => ({
      currentStepId: 'customize',
      stepSequence,
      direction: 1,
      selectedCategory: 'studio',
      selectedGrid: 6,
      gridConfig: {
        rows: 3,
        cols: 2,
        size: 6,
        price: 360,
        label: '6 piezas',
      },
      imageSrc: null,
      cropAreaPixels: null,
      liveCropArea: null,
      customizationValues: {},
      isUploading: false,
      layoutRotated: false,
      canRotateLayout: false,
      // UAT-3 Phase 3b: split shape — generic multi-photo state +
      // Tonos-only effects.
      multiPhoto: {
        imageSrcs: [null, null, null],
        cropAreas: [null, null, null],
        liveCropAreas: [null, null, null],
        resetSeq: [0, 0, 0],
        fileRefs: { current: [null, null, null] },
      },
      tonosEffects: {
        intensity: 'medium',
        slots: [
          { fitMode: 'fill', rotation: 0 },
          { fitMode: 'fill', rotation: 0 },
          { fitMode: 'fill', rotation: 0 },
        ],
      },
      handleCategorySelect: () => {},
      handleGridSelect: () => {},
      handleImageSelected: () => {},
      handleCropComplete: () => {},
      handleCropChange: () => {},
      handleReplaceSingleImage: () => {},
      handleLayoutRotate: () => {},
      handleCustomizationChange: () => {},
      handleCustomizeComplete: () => {},
      advanceFromCustomize: () => {},
      handleBack: () => {},
      handleReset: () => {},
      handleMultiPhotoImagesSelected: () => {},
      handleMultiPhotoCropChange: () => {},
      handleMultiPhotoCropComplete: () => {},
      handleMultiPhotoSlotReset: () => {},
      handleMultiPhotoSlotReplacePhoto: () => {},
      advanceFromMultiCrop: () => {},
      setTonosIntensity: () => {},
      setTonosFitMode: () => {},
      toggleTonosRotation: () => {},
    }),
    getStepsForCategory: () => stepSequence,
  };
});

vi.mock('@/components/builder/CategorySelector', () => {
  const C = () => null;
  C.displayName = 'MockCategorySelector';
  return { CategorySelector: C };
});
vi.mock('@/components/builder/GridSelector', () => {
  const C = () => null;
  C.displayName = 'MockGridSelector';
  return { GridSelector: C };
});
vi.mock('@/components/builder/PhotoUploader', () => {
  const C = () => null;
  C.displayName = 'MockPhotoUploader';
  return { PhotoUploader: C };
});
vi.mock('@/components/builder/PhotoUploaderMulti', () => {
  const C = () => null;
  C.displayName = 'MockPhotoUploaderMulti';
  return { PhotoUploaderMulti: C };
});
vi.mock('@/components/builder/ImageCropper', () => {
  const C = () => null;
  C.displayName = 'MockImageCropper';
  return { ImageCropper: C };
});
vi.mock('@/components/builder/ImageCropperMulti', () => {
  const C = () => null;
  C.displayName = 'MockImageCropperMulti';
  return { ImageCropperMulti: C };
});
vi.mock('@/components/builder/MagnetPreview', () => {
  const C = () => null;
  C.displayName = 'MockMagnetPreview';
  return { MagnetPreview: C };
});
vi.mock('@/components/builder/CustomizationEditor', () => {
  const C = () => null;
  C.displayName = 'MockCustomizationEditor';
  return { CustomizationEditor: C };
});
vi.mock('@/components/ui/Overlay', () => {
  const Overlay = ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  );
  const OverlayTitle = ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  );
  Overlay.displayName = 'MockOverlay';
  OverlayTitle.displayName = 'MockOverlayTitle';
  return { Overlay, OverlayTitle };
});

import { MagnetBuilder } from '@/components/builder/MagnetBuilder';

describe('MagnetBuilder mobile bottom padding — keyboardInset wiring (UAT-3 J12)', () => {
  test('mobileBottomPadStyle paddingBottom includes keyboardInset when keyboard is open', () => {
    const { container } = render(<MagnetBuilder />);

    // The builder root carries `mobileBottomPadStyle` as an inline style.
    // Find any element whose inline style includes a calc() that
    // references the mock keyboardInset value. There's no testid on it,
    // but the class is `container-mosaiko py-6 md:py-10`.
    const wrap = container.querySelector<HTMLElement>(
      '.container-mosaiko.py-6',
    );
    expect(wrap, 'expected to find the builder root container').not.toBeNull();
    if (!wrap) return;

    const padding = wrap.style.paddingBottom;
    expect(
      padding,
      'paddingBottom must include the keyboardInset value so the form content (and the inline CTA at its end) can scroll clear of the keyboard',
    ).toContain(`${KEYBOARD_INSET_PX}px`);
  });
});
