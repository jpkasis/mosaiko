'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Overlay, OverlayTitle } from '@/components/ui/Overlay';

const NAV_ITEMS = [
  {
    label: 'Pedidos',
    href: '/admin/pedidos',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z" />
        <line x1="3" y1="6" x2="21" y2="6" />
        <path d="M16 10a4 4 0 01-8 0" />
      </svg>
    ),
  },
  {
    label: 'Productos',
    href: '/admin/productos',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="7" height="7" />
        <rect x="14" y="3" width="7" height="7" />
        <rect x="3" y="14" width="7" height="7" />
        <rect x="14" y="14" width="7" height="7" />
      </svg>
    ),
  },
  {
    label: 'Configuración',
    href: '/admin/configuracion',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z" />
      </svg>
    ),
  },
];

function SidebarBody({
  pathname,
  onNavigate,
  showCloseButton,
}: {
  pathname: string;
  onNavigate: () => void;
  showCloseButton: boolean;
}) {
  return (
    <>
      {/* Brand */}
      <div className="flex h-16 items-center justify-between px-6" style={{ borderBottom: '1px solid #e5e0d4' }}>
        <Link href="/admin" className="flex items-center gap-2" onClick={onNavigate}>
          <span
            className="text-xl font-bold tracking-tight"
            style={{ fontFamily: 'var(--font-cormorant), Georgia, serif', color: '#422102' }}
          >
            Mosaiko
          </span>
          <span className="rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider" style={{ backgroundColor: '#e5e0d4', color: '#7a6b5a' }}>
            Admin
          </span>
        </Link>
        {showCloseButton && (
          <button
            onClick={onNavigate}
            className="flex h-12 w-12 cursor-pointer items-center justify-center rounded-lg hover:bg-cream"
            aria-label="Cerrar menú"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#422102" strokeWidth="2" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4">
        <ul className="flex flex-col gap-1">
          {NAV_ITEMS.map((item) => {
            const isActive = pathname.startsWith(item.href);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  onClick={onNavigate}
                  className={[
                    'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                    isActive
                      ? 'bg-terracotta/10 text-terracotta'
                      : 'text-warm-gray hover:bg-cream hover:text-charcoal',
                  ].join(' ')}
                >
                  <span className={isActive ? 'text-terracotta' : 'text-warm-gray'}>{item.icon}</span>
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Footer */}
      <div className="px-4 py-3 text-center text-[11px] text-warm-gray/50" style={{ borderTop: '1px solid #e5e0d4' }}>
        Mosaiko v1.0
      </div>
    </>
  );
}

export function AdminSidebar() {
  const pathname = usePathname();
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const closeMobile = () => setIsMobileOpen(false);

  return (
    <>
      {/* Mobile hamburger */}
      <button
        onClick={() => setIsMobileOpen(true)}
        className="fixed left-4 top-4 flex h-12 w-12 cursor-pointer items-center justify-center rounded-lg bg-white shadow-sm lg:hidden"
        style={{ border: '1px solid #e5e0d4', zIndex: 'var(--z-header)' }}
        aria-label="Abrir menú"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#422102" strokeWidth="2" strokeLinecap="round">
          <line x1="3" y1="6" x2="21" y2="6" />
          <line x1="3" y1="12" x2="21" y2="12" />
          <line x1="3" y1="18" x2="21" y2="18" />
        </svg>
      </button>

      {/* Desktop sidebar — static, always visible on lg+ */}
      <aside
        className="fixed inset-y-0 left-0 hidden w-64 flex-col bg-white lg:flex"
        style={{ borderRight: '1px solid #e5e0d4', zIndex: 'var(--z-header)' }}
      >
        <SidebarBody
          pathname={pathname}
          onNavigate={() => undefined}
          showCloseButton={false}
        />
      </aside>

      {/* Mobile sidebar — overlay-wrapped drawer below lg */}
      <Overlay
        open={isMobileOpen}
        onOpenChange={setIsMobileOpen}
        variant="drawer-left"
        zLayer="drawer"
        ariaLabel="Menú de administración"
        contentClassName="bg-white sm:max-w-[280px]"
      >
        <OverlayTitle className="sr-only">Menú de administración</OverlayTitle>
        <SidebarBody
          pathname={pathname}
          onNavigate={closeMobile}
          showCloseButton
        />
      </Overlay>
    </>
  );
}
