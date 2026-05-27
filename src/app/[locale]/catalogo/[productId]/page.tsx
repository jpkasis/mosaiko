import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { PRODUCTS } from '@/lib/catalog-data';
import { getProductByIdAsync } from '@/lib/catalog-data.server';
import { getPurchaseMode } from '@/lib/catalog-purchase-mode';
import { PredesignedPreview } from '@/components/catalog/PredesignedPreview';
import { LayoutExamplePreview } from '@/components/catalog/LayoutExamplePreview';

// Allow dynamic product IDs (admin-uploaded) to render on-demand
export const dynamicParams = true;

interface Props {
  params: Promise<{ locale: string; productId: string }>;
}

export async function generateStaticParams() {
  // Pre-render every static product. Both as-is (Studio/Arte) and
  // layout-example (everything else) reach the customer through this
  // route — the difference is the preview shell, not the route.
  return PRODUCTS.map((p) => ({ productId: p.id }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, productId } = await params;
  const product = await getProductByIdAsync(productId);
  if (!product) return {};

  const t = await getTranslations({ locale, namespace: 'catalogPage' });
  return {
    title: `${product.name} — Mosaiko`,
    description: t('metaDescription'),
  };
}

export default async function ProductDetailPage({ params }: Props) {
  const { locale, productId } = await params;
  setRequestLocale(locale);

  const product = await getProductByIdAsync(productId);
  if (!product) notFound();

  const mode = getPurchaseMode(product.category);

  return (
    <main className="mx-auto max-w-2xl px-4 py-8 md:py-12">
      {mode === 'as-is' ? (
        <PredesignedPreview productId={productId} initialProduct={product} />
      ) : (
        <LayoutExamplePreview productId={productId} initialProduct={product} />
      )}
    </main>
  );
}
