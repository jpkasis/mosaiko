// @vitest-environment jsdom
/**
 * UAT-2 contract test: the mobile sticky CTA in MagnetBuilder MUST NOT
 * be a DOM descendant of the animated step container.
 *
 * Why this matters: on iOS Safari, a CSS `transform` on an ancestor
 * collapses `position: fixed`'s viewport-relative containment, so a
 * fixed-positioned child ends up positioned relative to the transformed
 * ancestor instead of the viewport. The builder's animated step
 * container (`motion.div` with slide variants) applies a transform.
 * If anyone moves the sticky CTA back inside that container, the CTA
 * stops sticking to the viewport bottom and starts floating inside the
 * form area — exactly the regression UAT-2 surfaced.
 *
 * The contract is structural: `animatedStep.contains(stickyCta) === false`.
 * jsdom can't reproduce the iOS-Safari runtime breakage, but the DOM
 * ancestry assertion is what actually goes wrong on the device. This
 * locks the architectural composition; a refactor from `<AnimatePresence>`
 * to `<Fragment>` or anything else is fine as long as the CTA stays
 * outside the animated container.
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

// next/dynamic — pass-through to a null component (we don't need the
// dynamically imported children to render for this structural test).
function MockDynamicNoop() {
  return null;
}
MockDynamicNoop.displayName = 'MockDynamicNoop';
vi.mock('next/dynamic', () => ({ default: () => MockDynamicNoop }));

// Framer Motion: keep DOM tag structure, drop animation behavior.
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

// Zustand cart store: selector returns undefined regardless of argument.
vi.mock('@/lib/cart-store', () => ({
  useCartStore: () => () => undefined,
}));

// Keyboard inset hook: 0 (keyboard closed).
vi.mock('@/components/builder/useKeyboardInset', () => ({
  useKeyboardInset: () => 0,
}));

// useBuilderFlow stub. Pins the flow into the `customize` step where
// the sticky CTA is unconditionally `visible: true` per MagnetBuilder.
vi.mock('@/components/builder/useBuilderFlow', () => {
  const stepSequence = [
    'category',
    'grid',
    'upload',
    'crop',
    'customize',
    'preview',
  ];
  // MagnetBuilder's step indicator looks these up by currentStepId.
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
      // Tonos-only effects (intensity/slots).
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
      // Action stubs — none fire during initial render.
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

// Heavy child components — render to null. Their internals are not
// part of the sticky-CTA-ancestry contract. Each factory inlines its
// own component because `vi.mock` factories hoist above top-level
// definitions, so we can't share helpers.
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

describe('MagnetBuilder sticky CTA — DOM ancestry contract (UAT-2)', () => {
  test('sticky CTA is NOT a descendant of the animated step container', () => {
    const { container } = render(<MagnetBuilder />);

    const stickyCta = container.querySelector<HTMLElement>(
      '[data-testid="builder-sticky-cta"]',
    );
    const animatedStep = container.querySelector<HTMLElement>(
      '[data-testid="builder-animated-step"]',
    );

    expect(stickyCta, 'sticky CTA testid not found').not.toBeNull();
    expect(animatedStep, 'animated step testid not found').not.toBeNull();
    if (!stickyCta || !animatedStep) return;

    expect(
      animatedStep.contains(stickyCta),
      'sticky CTA must NOT be inside the animated step container (iOS transform-vs-fixed)',
    ).toBe(false);

    // Sanity: the sticky CTA's nearest fixed-positioned ancestor IS
    // itself (i.e. the CTA wrapper carries the fixed class). Locks the
    // viewport-bottom intent.
    expect(stickyCta.className).toMatch(/\bfixed\b/);
    expect(stickyCta.className).toMatch(/\binset-x-0\b/);
    expect(stickyCta.className).toMatch(/\blg:hidden\b/);
  });
});
