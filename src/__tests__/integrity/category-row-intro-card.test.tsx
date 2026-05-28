// @vitest-environment jsdom
/**
 * UAT-2 contract test: every entry in CATALOG_CATEGORIES renders the
 * "Crea el tuyo / Personalizar" intro card as the first item in its
 * carousel. Locks the removal of the dead `showPersonalizeCard` flag —
 * if anyone reintroduces a per-category conditional, this fails.
 */
import { describe, test, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';

// useTranslations → identity so we can assert on i18n keys directly.
vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

// Replace the i18n-aware Link with a plain anchor that stamps the
// resolved href into `data-href`. The CategoryRow + PersonalizeCard
// chain passes `{ pathname, query }` objects through; serialize them.
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
    <a data-testid="intl-link" data-href={resolved} {...rest}>
      {children}
    </a>
  );
}
MockIntlLink.displayName = 'MockIntlLink';

vi.mock('@/i18n/navigation', () => ({ Link: MockIntlLink }));

// Framer Motion shells — strip animation, keep DOM structure.
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
    motion: new Proxy(
      {},
      {
        get: (_t, name: string) => tag(name),
      },
    ),
    useInView: () => true,
    AnimatePresence: MockAnimatePresence,
  };
});

import { CATALOG_CATEGORIES } from '@/lib/catalog-data';
import { CategoryRow } from '@/components/catalog/CategoryRow';

describe('CategoryRow — intro PersonalizeCard renders for every category (UAT-2)', () => {
  test.each(CATALOG_CATEGORIES)(
    'category "$type" → first [data-card] is the Personalizar intro with pathname=/personalizar?category=$type',
    (category) => {
      const { container } = render(
        <CategoryRow category={category} products={[]} index={0} />,
      );

      // Codex audit tightening: assert the FIRST [data-card] is the
      // intro card, not just "any anchor in the row." With `products={[]}`
      // there are no product cards, so a regression that drops the intro
      // card would leave the row empty — which this assertion catches.
      const firstCard = container.querySelector<HTMLElement>('[data-card]');
      expect(
        firstCard,
        `category "${category.type}" produced no [data-card] — intro card is missing`,
      ).not.toBeNull();
      if (!firstCard) return;

      const introLink = firstCard.querySelector<HTMLAnchorElement>(
        'a[data-testid="intl-link"]',
      );
      expect(
        introLink,
        `first card for category "${category.type}" has no intro link`,
      ).not.toBeNull();
      if (!introLink) return;

      const href = introLink.getAttribute('data-href') ?? '';
      // Pathname + exact category query: rules out a stale product link
      // and any partial-match false-positive.
      const [pathname, search] = href.split('?');
      expect(pathname).toBe('/personalizar');
      const params = new URLSearchParams(search ?? '');
      expect(params.get('category')).toBe(category.type);
      expect(params.get('grid')).toBeNull(); // intro link is category-only
    },
  );

  test('renders exactly 7 categories (regression guard against accidental category removal)', () => {
    expect(CATALOG_CATEGORIES).toHaveLength(7);
  });
});
