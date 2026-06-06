import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ContactContent } from '@/components/contact/ContactContent';
import { getBusinessSettings, type SupportedLocale } from '@/lib/site-content';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'contactPage' });

  return {
    title: t('metaTitle'),
    description: t('metaDescription'),
  };
}

export default async function ContactPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const business = await getBusinessSettings(locale as SupportedLocale);

  return (
    <ContactContent
      business={{
        whatsapp: business.whatsapp,
        whatsappMessage: business.whatsappMessage,
        phone: business.phone,
        address: business.address,
      }}
    />
  );
}
