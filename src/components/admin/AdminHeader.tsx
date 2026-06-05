'use client';

import { usePathname, useRouter } from 'next/navigation';

const PAGE_TITLES: Record<string, string> = {
  '/admin/pedidos': 'Pedidos',
  '/admin/productos': 'Productos',
  '/admin/precios': 'Precios',
  '/admin/configuracion': 'Configuración',
};

export function AdminHeader() {
  const pathname = usePathname();
  const router = useRouter();

  // Find matching title
  const title = Object.entries(PAGE_TITLES).find(([path]) =>
    pathname.startsWith(path),
  )?.[1] || 'Admin';

  async function handleLogout() {
    await fetch('/api/admin/auth/logout', { method: 'POST' });
    router.push('/admin/login');
  }

  return (
    <header
      className="flex h-16 items-center justify-between px-4 md:px-6 lg:px-8"
      style={{ borderBottom: '1px solid #e5e0d4', backgroundColor: 'white' }}
    >
      {/* Page title — offset left on mobile to account for hamburger */}
      <h1
        className="pl-12 text-lg font-semibold text-charcoal lg:pl-0"
        style={{ fontFamily: 'var(--font-cormorant), Georgia, serif' }}
      >
        {title}
      </h1>

      {/* Logout */}
      <button
        onClick={handleLogout}
        className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm text-warm-gray transition-colors hover:bg-cream hover:text-charcoal"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" />
          <polyline points="16 17 21 12 16 7" />
          <line x1="21" y1="12" x2="9" y2="12" />
        </svg>
        Cerrar sesión
      </button>
    </header>
  );
}
