'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import type { ContactSubmission } from '@/lib/shopify/mutations/contact-submissions';

const STATUS_LABEL: Record<string, string> = {
  new: 'Nuevo',
  read: 'Leído',
  archived: 'Archivado',
};

const STATUS_CLASS: Record<string, string> = {
  new: 'bg-terracotta/10 text-terracotta',
  read: 'bg-emerald-50 text-emerald-700',
  archived: 'bg-light-gray/40 text-warm-gray',
};

/** Formats an ISO date for the Mexican locale; falls back to the raw string. */
function formatDate(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('es-MX', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
        STATUS_CLASS[status] ?? STATUS_CLASS.archived
      }`}
    >
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}

function SubmissionCard({
  submission,
  onMarkRead,
  pending,
}: {
  submission: ContactSubmission;
  onMarkRead: (id: string) => void;
  pending: boolean;
}) {
  return (
    <div className="rounded-xl bg-white p-5 shadow-sm" style={{ border: '1px solid #e5e0d4' }}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate text-base font-semibold text-charcoal">
            {submission.subject || '(Sin asunto)'}
          </h3>
          <p className="mt-0.5 text-sm text-warm-gray">
            <span className="font-medium text-charcoal">{submission.name}</span>
            {' · '}
            <a
              href={`mailto:${submission.email}`}
              className="underline decoration-dotted underline-offset-2 hover:text-terracotta"
            >
              {submission.email}
            </a>
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <StatusBadge status={submission.status} />
          <span className="text-xs text-warm-gray/70">{formatDate(submission.createdAt)}</span>
        </div>
      </div>

      <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-charcoal/90">
        {submission.message}
      </p>

      {submission.status === 'new' && (
        <div className="mt-4 flex justify-end">
          <button
            onClick={() => onMarkRead(submission.id)}
            disabled={pending}
            className="rounded-lg bg-terracotta px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-terracotta/90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {pending ? 'Guardando…' : 'Marcar como leído'}
          </button>
        </div>
      )}
    </div>
  );
}

export function ContactosListContent() {
  const [submissions, setSubmissions] = useState<ContactSubmission[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch('/api/admin/contact-submissions', { cache: 'no-store' });
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setError(data.error?.message || 'Error al cargar los mensajes.');
          return;
        }
        setSubmissions(data.submissions ?? []);
      } catch {
        if (!cancelled) setError('Error de conexión.');
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleMarkRead = useCallback(async (id: string) => {
    setPendingId(id);
    try {
      const res = await fetch('/api/admin/contact-submissions', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status: 'read' }),
      });
      if (res.ok) {
        setSubmissions((prev) =>
          prev.map((s) => (s.id === id ? { ...s, status: 'read' } : s)),
        );
      }
    } catch {
      // Leave status unchanged; the admin can retry.
    } finally {
      setPendingId(null);
    }
  }, []);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-3 border-light-gray border-t-terracotta" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl bg-white p-8 text-center shadow-sm" style={{ border: '1px solid #e5e0d4' }}>
        <p className="text-warm-gray">{error}</p>
        <p className="mt-2 text-sm text-warm-gray/60">
          Asegúrate de que Shopify esté configurado correctamente.
        </p>
      </div>
    );
  }

  if (submissions.length === 0) {
    return (
      <div className="rounded-xl bg-white p-12 text-center shadow-sm" style={{ border: '1px solid #e5e0d4' }}>
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#7a6b5a" strokeWidth="1.5" className="mx-auto mb-4">
          <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
          <polyline points="22,6 12,13 2,6" />
        </svg>
        <p className="text-warm-gray">No hay mensajes aún.</p>
        <p className="mt-2 text-sm text-warm-gray/60">
          Los mensajes enviados desde la página de contacto aparecerán aquí.
        </p>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="flex flex-col gap-3"
    >
      {submissions.map((submission, index) => (
        <motion.div
          key={submission.id}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: index * 0.03 }}
        >
          <SubmissionCard
            submission={submission}
            onMarkRead={handleMarkRead}
            pending={pendingId === submission.id}
          />
        </motion.div>
      ))}
    </motion.div>
  );
}
