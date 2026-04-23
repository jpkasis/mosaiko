'use client';

import { useCallback, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/Button';
import type { TonosIndex } from './useBuilderFlow';

interface PhotoUploaderMultiProps {
  imageSrcs: [string | null, string | null, string | null];
  onImageSelected: (index: TonosIndex, file: File) => void;
  onAllReady: () => void;
}

const MAX_FILE_SIZE = 20 * 1024 * 1024;

const SLOT_LABELS: Record<TonosIndex, { label: string; hint: string }> = {
  0: { label: 'Foto 1', hint: 'Columna cálida' },
  1: { label: 'Foto 2', hint: 'Columna neutra' },
  2: { label: 'Foto 3', hint: 'Columna fría' },
};

export function PhotoUploaderMulti({
  imageSrcs,
  onImageSelected,
  onAllReady,
}: PhotoUploaderMultiProps) {
  const t = useTranslations('builder');
  const tc = useTranslations('common');

  const [error, setError] = useState<string | null>(null);

  const validateAndSelect = useCallback(
    (index: TonosIndex, file: File) => {
      setError(null);
      if (!file.type.startsWith('image/')) {
        setError('Por favor selecciona un archivo de imagen.');
        return;
      }
      if (file.size > MAX_FILE_SIZE) {
        setError('La imagen es demasiado grande. Máximo 20MB.');
        return;
      }
      onImageSelected(index, file);
    },
    [onImageSelected],
  );

  const allReady = imageSrcs.every((s) => s !== null);

  return (
    <div className="flex flex-col gap-6">
      <div className="text-center">
        <h2 className="font-serif text-2xl font-bold text-charcoal md:text-3xl">
          {t('tonosUploadTitle')}
        </h2>
        <p className="mt-2 text-sm text-warm-gray md:text-base">
          {t('tonosUploadHint')}
        </p>
        <p className="mt-1 text-xs text-warm-gray/80">
          Cualquier formato de imagen · máx. 20 MB por foto
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {([0, 1, 2] as TonosIndex[]).map((idx) => (
          <TonosSlot
            key={idx}
            index={idx}
            src={imageSrcs[idx]}
            label={SLOT_LABELS[idx].label}
            hint={SLOT_LABELS[idx].hint}
            onFile={(file) => validateAndSelect(idx, file)}
          />
        ))}
      </div>

      <AnimatePresence>
        {error && (
          <motion.p
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="text-center text-sm text-error"
          >
            {error}
          </motion.p>
        )}
      </AnimatePresence>

      <Button
        variant="primary"
        size="lg"
        fullWidth
        onClick={onAllReady}
        disabled={!allReady}
      >
        {tc('next')}
      </Button>
    </div>
  );
}

// ─── Slot ───────────────────────────────────────────────────────────────────

function TonosSlot({
  index,
  src,
  label,
  hint,
  onFile,
}: {
  index: TonosIndex;
  src: string | null;
  label: string;
  hint: string;
  onFile: (file: File) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) onFile(file);
      e.target.value = '';
    },
    [onFile],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const file = e.dataTransfer.files?.[0];
      if (file) onFile(file);
    },
    [onFile],
  );

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.06 }}
      className="flex flex-col gap-2"
    >
      <div className="flex items-baseline justify-between">
        <span className="text-sm font-semibold text-charcoal">{label}</span>
        <span className="text-xs text-warm-gray">{hint}</span>
      </div>

      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        onDrop={handleDrop}
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={(e) => { e.preventDefault(); setIsDragging(false); }}
        className={[
          'group relative flex aspect-square w-full cursor-pointer items-center justify-center overflow-hidden rounded-xl border-2 border-dashed transition-colors duration-200',
          src
            ? 'border-terracotta bg-white'
            : isDragging
              ? 'border-terracotta bg-terracotta/5'
              : 'border-light-gray bg-white hover:border-terracotta-light',
        ].join(' ')}
        aria-label={`Subir ${label}`}
      >
        {src ? (
          <>
            <img src={src} alt={label} className="h-full w-full object-cover" draggable={false} />
            <div className="absolute inset-0 flex items-center justify-center bg-charcoal/0 opacity-0 transition-all duration-200 group-hover:bg-charcoal/30 group-hover:opacity-100">
              <span className="rounded-full bg-white/90 px-3 py-1.5 text-xs font-medium text-charcoal">
                Cambiar
              </span>
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center gap-3 p-6 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-cream">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-charcoal">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <polyline points="21 15 16 10 5 21" />
              </svg>
            </div>
            <span className="text-xs font-medium text-warm-gray">
              Toca para subir
            </span>
          </div>
        )}
      </button>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        onChange={handleChange}
        className="hidden"
        aria-hidden="true"
      />
    </motion.div>
  );
}
