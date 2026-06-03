'use client';

import { useState, useCallback } from 'react';

const MIN_LEN = 12;

interface PasswordApiError {
  error?: {
    code?: string;
    message?: string;
    fieldErrors?: {
      currentPassword?: string;
      newPassword?: string;
      confirmPassword?: string;
    };
  };
}

/**
 * Cuenta tab — change the admin password. Self-contained state. On success,
 * clears the fields and shows a banner. The Shopify metafield write happens
 * server-side; this component only collects + posts.
 */
export function CuentaForm() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<
    | { kind: 'idle' }
    | { kind: 'success' }
    | { kind: 'error'; message: string }
  >({ kind: 'idle' });

  // Client-side pre-check mirrors server validation for instant feedback.
  const clientError = (() => {
    if (next.length > 0 && next.length < MIN_LEN) {
      return `La nueva contraseña debe tener al menos ${MIN_LEN} caracteres.`;
    }
    if (confirm.length > 0 && next !== confirm) {
      return 'Las contraseñas no coinciden.';
    }
    if (next.length > 0 && next === current) {
      return 'La nueva contraseña debe ser diferente a la actual.';
    }
    return null;
  })();

  const canSubmit =
    !saving &&
    current.length > 0 &&
    next.length >= MIN_LEN &&
    next === confirm &&
    next !== current;

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!canSubmit) return;
      setSaving(true);
      setStatus({ kind: 'idle' });
      try {
        const res = await fetch('/api/admin/configuracion/cuenta/password', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            currentPassword: current,
            newPassword: next,
            confirmPassword: confirm,
          }),
        });
        if (!res.ok) {
          const data = (await res.json()) as PasswordApiError;
          const fieldMsg =
            data.error?.fieldErrors?.currentPassword ||
            data.error?.fieldErrors?.newPassword ||
            data.error?.fieldErrors?.confirmPassword;
          setStatus({
            kind: 'error',
            message:
              fieldMsg ??
              data.error?.message ??
              'No se pudo cambiar la contraseña.',
          });
          return;
        }
        setCurrent('');
        setNext('');
        setConfirm('');
        setStatus({ kind: 'success' });
      } catch (error) {
        console.error('[CuentaForm] submit failed:', error);
        setStatus({ kind: 'error', message: 'Error de red. Intenta de nuevo.' });
      } finally {
        setSaving(false);
      }
    },
    [canSubmit, current, next, confirm],
  );

  const inputClass =
    'w-full rounded-lg border border-light-gray bg-white px-3 py-2 text-sm text-charcoal focus:border-terracotta focus:outline-none focus:ring-1 focus:ring-terracotta/30';

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h2
          className="text-2xl font-semibold text-charcoal"
          style={{ fontFamily: 'var(--font-cormorant), Georgia, serif' }}
        >
          Cuenta
        </h2>
        <p className="text-sm text-warm-gray">
          Cambia tu contraseña de administrador. Tu sesión actual seguirá
          activa después del cambio.
        </p>
      </header>

      {status.kind === 'success' && (
        <div
          role="status"
          className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700"
        >
          Contraseña actualizada.
        </div>
      )}
      {status.kind === 'error' && (
        <div
          role="alert"
          className="rounded-lg border border-error/30 bg-error/5 px-4 py-3 text-sm text-error"
        >
          {status.message}
        </div>
      )}

      <form
        onSubmit={handleSubmit}
        className="max-w-md space-y-5 rounded-xl border border-light-gray bg-white p-5"
      >
        <div className="flex flex-col gap-1.5">
          <label htmlFor="current-password" className="text-sm font-medium text-charcoal">
            Contraseña actual
          </label>
          <input
            id="current-password"
            type="password"
            autoComplete="current-password"
            value={current}
            onChange={(e) => {
              setCurrent(e.target.value);
              setStatus({ kind: 'idle' });
            }}
            className={inputClass}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="new-password" className="text-sm font-medium text-charcoal">
            Nueva contraseña
          </label>
          <input
            id="new-password"
            type="password"
            autoComplete="new-password"
            value={next}
            onChange={(e) => {
              setNext(e.target.value);
              setStatus({ kind: 'idle' });
            }}
            className={inputClass}
          />
          <p className="text-[11px] text-warm-gray/70">
            Mínimo {MIN_LEN} caracteres.
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="confirm-password" className="text-sm font-medium text-charcoal">
            Confirmar nueva contraseña
          </label>
          <input
            id="confirm-password"
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => {
              setConfirm(e.target.value);
              setStatus({ kind: 'idle' });
            }}
            className={inputClass}
          />
        </div>

        {clientError && (
          <p role="alert" className="text-xs text-error">
            {clientError}
          </p>
        )}

        <button
          type="submit"
          disabled={!canSubmit}
          className="rounded-lg bg-terracotta px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-terracotta/90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {saving ? 'Guardando…' : 'Cambiar contraseña'}
        </button>
      </form>
    </div>
  );
}
