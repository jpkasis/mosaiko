import type { Metadata } from 'next';
import { setRequestLocale } from 'next-intl/server';
import { CartItemDetail } from '@/components/cart/CartItemDetail';

type Props = {
  params: Promise<{ locale: string; itemId: string }>;
};

export const metadata: Metadata = {
  title: 'Vista previa — Mosaiko',
};

export default async function CartItemDetailPage({ params }: Props) {
  const { locale, itemId } = await params;
  setRequestLocale(locale);

  // The detail content is fully client-side: cart state lives in
  // localStorage / Zustand, so SSR'ing the item lookup would render an
  // empty page for everyone. The shell here just provides the locale
  // and metadata; CartItemDetail handles the data flow.
  return <CartItemDetail itemId={itemId} />;
}
