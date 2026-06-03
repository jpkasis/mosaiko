// @vitest-environment jsdom
/**
 * UAT-6 PR6 contract tests — mobile CTA polish.
 *
 * Issue A: the customize step's primary action is now an INLINE button in
 * CustomizationEditor, visible on mobile. The floating sticky CTA that
 * jittered over the iOS keyboard and covered the text fields was removed
 * from this step (see builder-sticky-cta-position.test.tsx, now pinned to
 * the `upload` step). Guard: the inline CTA must NOT be hidden at the
 * mobile breakpoint (pre-PR6 its wrapper was `hidden lg:block`).
 *
 * Issue B: the cart drawer footer links ("Ver carrito completo" /
 * "Seguir comprando") must be real ≥48px tap targets, not the bare ~20px
 * text links the client reported as hard to tap.
 */
import { describe, test, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

import { CustomizationEditor } from '@/components/builder/CustomizationEditor';

describe('UAT-6 PR6 — customize inline CTA is visible on mobile', () => {
  test('the inline golden CTA is not display:none at the mobile breakpoint', () => {
    const { container } = render(
      <CustomizationEditor
        category="spotify"
        values={{}}
        onValueChange={() => {}}
        onComplete={() => {}}
      />,
    );
    // The inline CTA is the only button carrying the golden `bg-btn-primary`.
    const cta = container.querySelector<HTMLElement>('button.bg-btn-primary');
    expect(cta, 'expected the inline golden CTA button').not.toBeNull();
    // Pre-PR6 the wrapper was `hidden lg:block` → display:none on mobile.
    // After PR6 it must have no `hidden` ancestor so mobile users see it.
    expect(cta?.closest('.hidden')).toBeNull();
    // And it stays a ≥48px target.
    expect(cta?.className).toContain('min-h-[48px]');
  });
});

describe('UAT-6 PR6 — cart drawer footer links are real tap targets', () => {
  test('both footer links carry min-h-[48px] (not bare text)', () => {
    const src = readFileSync(
      join(process.cwd(), 'src/components/cart/CartDrawer.tsx'),
      'utf8',
    );
    // "Ver carrito completo" → /carrito ; "Seguir comprando" → /catalogo.
    // Each href appears once (the empty-cart CTA uses /personalizar), so a
    // non-greedy match to the next className captures that link's classes.
    const verCarrito = src.match(/href="\/carrito"[\s\S]*?className="([^"]+)"/);
    const seguirComprando = src.match(/href="\/catalogo"[\s\S]*?className="([^"]+)"/);
    expect(verCarrito?.[1], '"Ver carrito completo" link classes').toContain('min-h-[48px]');
    expect(seguirComprando?.[1], '"Seguir comprando" link classes').toContain('min-h-[48px]');
    // "Seguir comprando" must read as a real action, not low-contrast gray.
    expect(seguirComprando?.[1]).not.toContain('text-warm-gray');
  });
});
