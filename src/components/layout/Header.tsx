'use client';

import { useState, useEffect } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { useParams } from 'next/navigation';
import { Link, useRouter, usePathname } from '@/i18n/navigation';
import { useCartStore, selectCartCount } from '@/lib/cart-store';
import { BUILDER_RESET_EVENT } from '@/lib/builder-events';
import { motion, AnimatePresence } from 'framer-motion';
import { MosaikoLogo } from '@/components/ui/MosaikoLogo';

const NAV_LINKS = [
  { href: '/catalogo' as const, key: 'catalog' },
  { href: '/personalizar' as const, key: 'customize' },
] as const;

const MOBILE_NAV_LINKS = [
  { href: '/' as const, key: 'home' },
  { href: '/catalogo' as const, key: 'catalog' },
  { href: '/personalizar' as const, key: 'customize' },
  { href: '/nosotros' as const, key: 'about' },
  { href: '/preguntas-frecuentes' as const, key: 'faq' },
  { href: '/contacto' as const, key: 'contact' },
] as const;

export function Header() {
  const t = useTranslations('nav');
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const params = useParams();
  const cartCount = useCartStore(selectCartCount);

  const [scrolled, setScrolled] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    function handleScroll() {
      setScrolled(window.scrollY > 4);
    }
    window.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll();
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // Lock body scroll when mobile menu is open
  useEffect(() => {
    if (mobileMenuOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [mobileMenuOpen]);

  function handleLanguageSwitch() {
    const nextLocale = locale === 'es' ? 'en' : 'es';
    router.replace(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { pathname, params: params as any },
      { locale: nextLocale },
    );
  }

  function closeMobileMenu() {
    setMobileMenuOpen(false);
  }

  // When the user clicks the "Personalizar" nav from inside /personalizar,
  // the URL doesn't change so Link does nothing. Dispatch a custom event
  // that MagnetBuilder listens for to reset its flow to step 1.
  function handleNavClick(
    e: React.MouseEvent<HTMLAnchorElement>,
    href: string,
  ) {
    if (href === '/personalizar' && pathname === '/personalizar') {
      e.preventDefault();
      window.dispatchEvent(new Event(BUILDER_RESET_EVENT));
    }
  }

  return (
    <header
      className={[
        'sticky top-0 z-40 h-[var(--header-height)] bg-cream transition-shadow duration-300',
        scrolled ? 'shadow-sm border-b border-light-gray' : '',
      ].join(' ')}
    >
      <div className="container-mosaiko flex h-full items-center justify-between">
        {/* Logo */}
        <Link href="/" className="flex items-center" onClick={closeMobileMenu}>
          <MosaikoLogo variant="dark" size={28} />
        </Link>

        {/* Desktop Nav */}
        <nav className="hidden items-center gap-8 md:flex" aria-label="Navegacion principal">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.key}
              href={link.href}
              onClick={(e) => handleNavClick(e, link.href)}
              className="text-sm font-medium text-charcoal transition-colors hover:text-terracotta"
            >
              {t(link.key)}
            </Link>
          ))}
        </nav>

        {/* Right Actions */}
        <div className="flex items-center gap-3">
          {/* Language Toggle */}
          <button
            onClick={handleLanguageSwitch}
            className="hidden rounded-md px-2 py-1 text-xs font-semibold uppercase tracking-wide text-warm-gray transition-colors hover:text-charcoal md:block cursor-pointer"
            aria-label={t('language')}
          >
            {locale === 'es' ? 'EN' : 'ES'}
          </button>

          {/* Cart */}
          <Link
            href="/carrito"
            className="relative flex h-10 w-10 items-center justify-center rounded-lg transition-colors hover:bg-charcoal/5"
            aria-label={t('cart')}
          >
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-charcoal"
              aria-hidden="true"
            >
              <path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z" />
              <line x1="3" y1="6" x2="21" y2="6" />
              <path d="M16 10a4 4 0 01-8 0" />
            </svg>
            {cartCount > 0 && (
              <span className="absolute -right-0.5 -top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-terracotta text-[10px] font-bold text-white">
                {cartCount > 99 ? '99+' : cartCount}
              </span>
            )}
          </Link>

          {/* Mobile Hamburger */}
          <button
            onClick={() => setMobileMenuOpen((prev) => !prev)}
            className="relative flex h-10 w-10 items-center justify-center rounded-lg transition-colors hover:bg-charcoal/5 md:hidden cursor-pointer"
            aria-label={mobileMenuOpen ? 'Cerrar menu' : 'Abrir menu'}
            aria-expanded={mobileMenuOpen}
          >
            <div className="flex w-5 flex-col items-center gap-[5px]">
              <motion.span
                animate={
                  mobileMenuOpen
                    ? { rotate: 45, y: 7 }
                    : { rotate: 0, y: 0 }
                }
                transition={{ duration: 0.25 }}
                className="block h-[2px] w-5 rounded-full bg-charcoal"
              />
              <motion.span
                animate={
                  mobileMenuOpen ? { opacity: 0 } : { opacity: 1 }
                }
                transition={{ duration: 0.15 }}
                className="block h-[2px] w-5 rounded-full bg-charcoal"
              />
              <motion.span
                animate={
                  mobileMenuOpen
                    ? { rotate: -45, y: -7 }
                    : { rotate: 0, y: 0 }
                }
                transition={{ duration: 0.25 }}
                className="block h-[2px] w-5 rounded-full bg-charcoal"
              />
            </div>
          </button>
        </div>
      </div>

      {/* Mobile Menu Overlay */}
      <AnimatePresence>
        {mobileMenuOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 top-[var(--header-height)] z-50 bg-cream md:hidden"
          >
            <nav
              className="container-mosaiko flex flex-col gap-1 pt-6"
              aria-label="Navegacion movil"
            >
              {MOBILE_NAV_LINKS.map((link, i) => (
                <motion.div
                  key={link.key}
                  initial={{ opacity: 0, x: -16 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.05, duration: 0.25 }}
                >
                  <Link
                    href={link.href}
                    onClick={(e) => {
                      handleNavClick(e, link.href);
                      closeMobileMenu();
                    }}
                    className="flex h-12 items-center rounded-lg px-4 text-lg font-medium text-charcoal transition-colors hover:bg-terracotta/10 hover:text-terracotta"
                  >
                    {t(link.key)}
                  </Link>
                </motion.div>
              ))}

              {/* Language switch in mobile */}
              <motion.div
                initial={{ opacity: 0, x: -16 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{
                  delay: MOBILE_NAV_LINKS.length * 0.05,
                  duration: 0.25,
                }}
                className="mt-4 border-t border-light-gray pt-4"
              >
                <button
                  onClick={() => {
                    handleLanguageSwitch();
                    closeMobileMenu();
                  }}
                  className="flex h-12 items-center gap-2 rounded-lg px-4 text-lg font-medium text-warm-gray transition-colors hover:text-charcoal cursor-pointer"
                >
                  <svg
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <circle cx="12" cy="12" r="10" />
                    <line x1="2" y1="12" x2="22" y2="12" />
                    <path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z" />
                  </svg>
                  {locale === 'es' ? 'English' : 'Espanol'}
                </button>
              </motion.div>
            </nav>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}
