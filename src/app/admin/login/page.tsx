'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';

export default function AdminLoginPage() {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (isLoading || !password) return;

    setIsLoading(true);
    setError('');

    try {
      const res = await fetch('/api/admin/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });

      if (res.ok) {
        router.push('/admin/pedidos');
      } else {
        const data = await res.json();
        setError(data.error || 'Error al iniciar sesión.');
      }
    } catch {
      setError('Error de conexión. Intenta de nuevo.');
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-cream px-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="w-full max-w-sm"
      >
        {/* Branding */}
        <div className="mb-8 text-center">
          <h1
            className="text-4xl font-bold tracking-tight"
            style={{
              fontFamily: 'var(--font-cormorant), Georgia, serif',
              color: '#422102',
            }}
          >
            Mosaiko
          </h1>
          <p className="mt-1 text-sm text-warm-gray">Panel de administración</p>
        </div>

        {/* Login card */}
        <div className="rounded-2xl bg-white p-8 shadow-sm" style={{ border: '1px solid #e5e0d4' }}>
          <form onSubmit={handleSubmit} className="flex flex-col gap-5">
            {/* Email (decorative, for future use) */}
            <div>
              <label
                htmlFor="admin-email"
                className="mb-1.5 block text-sm font-medium text-charcoal"
              >
                Correo electrónico
              </label>
              <input
                id="admin-email"
                type="email"
                placeholder="username"
                className="h-11 w-full rounded-lg border border-light-gray bg-cream px-3.5 text-sm text-charcoal placeholder:text-warm-gray/60 focus:border-terracotta focus:outline-none focus:ring-2 focus:ring-terracotta/20"
                autoComplete="email"
              />
            </div>

            {/* Password */}
            <div>
              <label
                htmlFor="admin-password"
                className="mb-1.5 block text-sm font-medium text-charcoal"
              >
                Contraseña
              </label>
              <input
                id="admin-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="h-11 w-full rounded-lg border border-light-gray bg-cream px-3.5 text-sm text-charcoal placeholder:text-warm-gray/60 focus:border-terracotta focus:outline-none focus:ring-2 focus:ring-terracotta/20"
                autoComplete="current-password"
                required
              />
            </div>

            {/* Error */}
            {error && (
              <motion.p
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                className="text-sm text-error"
              >
                {error}
              </motion.p>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={isLoading || !password}
              className="flex h-11 w-full cursor-pointer items-center justify-center rounded-lg font-semibold text-white transition-colors disabled:cursor-not-allowed disabled:opacity-60"
              style={{ backgroundColor: '#7b3f1e' }}
            >
              {isLoading ? (
                <svg className="h-5 w-5 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="31.4 31.4" strokeLinecap="round" />
                </svg>
              ) : (
                'Iniciar sesión'
              )}
            </button>
          </form>
        </div>

        <p className="mt-6 text-center text-xs text-warm-gray/60">
          Mosaiko Admin — Solo personal autorizado
        </p>
      </motion.div>
    </div>
  );
}
