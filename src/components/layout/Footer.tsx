import { getTranslations, getLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { MosaikoLogo } from '@/components/ui/MosaikoLogo';
import { getBusinessSettings, type SupportedLocale } from '@/lib/site-content';

const SHOP_LINKS = [
  { href: '/catalogo' as const, key: 'catalog' },
  { href: '/personalizar' as const, key: 'customize' },
] as const;

const COMPANY_LINKS = [
  { href: '/nosotros' as const, key: 'about' },
  { href: '/preguntas-frecuentes' as const, key: 'faq' },
  { href: '/contacto' as const, key: 'contact' },
] as const;

const LEGAL_LINKS = [
  { href: '/terminos' as const, key: 'terms' },
  { href: '/privacidad' as const, key: 'privacy' },
  { href: '/politica-cookies' as const, key: 'cookies' },
] as const;

function InstagramIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <rect x="2" y="2" width="20" height="20" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

function FacebookIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M14 9h3V5h-3a4 4 0 0 0-4 4v2H7v4h3v6h4v-6h3l1-4h-4V9a1 1 0 0 1 1-1z" />
    </svg>
  );
}

function TikTokIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64 2.93 2.93 0 0 1 .88.13V9.4a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 5 20.1a6.34 6.34 0 0 0 10.86-4.43v-7a8.16 8.16 0 0 0 4.77 1.52v-3.4a4.85 4.85 0 0 1-1-.1z" />
    </svg>
  );
}

export async function Footer() {
  const locale = (await getLocale()) as SupportedLocale;
  const t = await getTranslations('footer');
  const tNav = await getTranslations('nav');
  const business = await getBusinessSettings(locale);

  const currentYear = new Date().getFullYear();
  const taglineText = business.footerCopy || t('tagline');
  const hasSocials = business.instagramUrl || business.facebookUrl || business.tiktokUrl;
  const hasContact = business.phone || business.address;

  return (
    <footer className="mt-auto bg-terracotta text-cream">
      {/* Main Footer */}
      <div className="container-mosaiko py-12 sm:py-16">
        <div className="grid grid-cols-1 gap-10 sm:grid-cols-2 lg:grid-cols-4">
          {/* Brand Column */}
          <div className="sm:col-span-2 lg:col-span-1">
            <Link href="/" className="inline-flex items-center">
              <MosaikoLogo variant="light" size={28} />
            </Link>
            <p className="mt-3 max-w-xs text-sm leading-relaxed text-cream/70">
              {taglineText}
            </p>

            {hasContact && (
              <div className="mt-4 space-y-1 text-xs text-cream/60">
                {business.phone && <p>{business.phone}</p>}
                {business.address && <p>{business.address}</p>}
              </div>
            )}

            {hasSocials && (
              <div className="mt-4 flex items-center gap-3">
                {business.instagramUrl && (
                  <a
                    href={business.instagramUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label="Instagram"
                    className="text-cream/70 transition-colors hover:text-cream"
                  >
                    <InstagramIcon />
                  </a>
                )}
                {business.facebookUrl && (
                  <a
                    href={business.facebookUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label="Facebook"
                    className="text-cream/70 transition-colors hover:text-cream"
                  >
                    <FacebookIcon />
                  </a>
                )}
                {business.tiktokUrl && (
                  <a
                    href={business.tiktokUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label="TikTok"
                    className="text-cream/70 transition-colors hover:text-cream"
                  >
                    <TikTokIcon />
                  </a>
                )}
              </div>
            )}
          </div>

          {/* Shop Links */}
          <div>
            <h3 className="text-sm font-semibold uppercase tracking-wider text-gold">
              {t('shop')}
            </h3>
            <ul className="mt-4 space-y-3">
              {SHOP_LINKS.map((link) => (
                <li key={link.key}>
                  <Link
                    href={link.href}
                    className="text-sm text-cream/70 transition-colors hover:text-cream"
                  >
                    {tNav(link.key)}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Company Links */}
          <div>
            <h3 className="text-sm font-semibold uppercase tracking-wider text-gold">
              {t('company')}
            </h3>
            <ul className="mt-4 space-y-3">
              {COMPANY_LINKS.map((link) => (
                <li key={link.key}>
                  <Link
                    href={link.href}
                    className="text-sm text-cream/70 transition-colors hover:text-cream"
                  >
                    {tNav(link.key)}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Legal Links */}
          <div>
            <h3 className="text-sm font-semibold uppercase tracking-wider text-gold">
              {t('legal')}
            </h3>
            <ul className="mt-4 space-y-3">
              {LEGAL_LINKS.map((link) => (
                <li key={link.key}>
                  <Link
                    href={link.href}
                    className="text-sm text-cream/70 transition-colors hover:text-cream"
                  >
                    {t(link.key)}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      {/* Bottom Bar */}
      <div className="border-t border-cream/10">
        <div className="container-mosaiko flex flex-col items-center justify-between gap-3 py-5 sm:flex-row">
          <p className="text-xs text-cream/50">
            &copy; {currentYear} {business.businessName || 'Mosaiko'}. {t('rights')}.
          </p>
          <p className="text-xs text-cream/50">
            {t('madeWith')}{' '}
            <span className="text-terracotta-light" aria-label="amor">
              &#9829;
            </span>{' '}
            {t('by')}{' '}
            <a
              href="https://outerhaven.mx"
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-cream/70 transition-colors hover:text-cream"
            >
              Outer Haven
            </a>
          </p>
        </div>
      </div>
    </footer>
  );
}
