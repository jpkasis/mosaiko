import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { CatalogContent } from '@/components/catalog/CatalogContent';
import { getAllProducts } from '@/lib/catalog-data.server';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'catalogPage' });

  return {
    title: t('metaTitle'),
    description: t('metaDescription'),
  };
}

export default async function CatalogPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const allProducts = await getAllProducts();

  return <CatalogContent products={allProducts} />;
}
