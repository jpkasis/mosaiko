import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { getProductById, PRODUCTS } from '@/lib/catalog-data';
import { getProductByIdAsync } from '@/lib/catalog-data.server';
import { PredesignedPreview } from '@/components/catalog/PredesignedPreview';

// Allow dynamic product IDs (admin-uploaded) to render on-demand
export const dynamicParams = true;

interface Props {
  params: Promise<{ locale: string; productId: string }>;
}

export async function generateStaticParams() {
  // Only pre-render static products; dynamic ones render on-demand via dynamicParams
  return PRODUCTS.filter((p) => p.isPredesigned).map((p) => ({
    productId: p.id,
  }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, productId } = await params;
  const product = await getProductByIdAsync(productId);
  if (!product || !product.isPredesigned) return {};

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
  if (!product || !product.isPredesigned) notFound();

  return (
    <main className="mx-auto max-w-2xl px-4 py-8 md:py-12">
      <PredesignedPreview productId={productId} initialProduct={product} />
    </main>
  );
}
