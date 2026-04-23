'use client';

import { useState, useRef, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { motion, AnimatePresence } from 'framer-motion';
import { assessImageQuality } from '@/lib/canvas-utils';
import type { GridConfig } from '@/lib/grid-config';
import { Button } from '@/components/ui/Button';

interface PhotoUploaderProps {
  onImageSelected: (file: File) => void;
  gridConfig: GridConfig;
}

type ImageQuality = 'good' | 'medium' | 'low' | null;

/**
 * Explicit upload phases. Having them named makes the flow auditable —
 * Codex's anti-pattern #1 was "upload black boxes: no progress, no
 * compression feedback, no retry, no explanation after failure."
 */
type UploadPhase = 'idle' | 'processing' | 'ready' | 'failed';

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB
// Accepted-format caption is locale-resolved (builder.uploadFormatsHint)
// so both /es and /en surface matches what `<input accept="image/*">`
// actually accepts — any image mime-type the device can decode.

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function PhotoUploader({ onImageSelected, gridConfig }: PhotoUploaderProps) {
  const t = useTranslations('builder');
  const tc = useTranslations('common');

  const [phase, setPhase] = useState<UploadPhase>('idle');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [quality, setQuality] = useState<ImageQuality>(null);
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);

  const processFile = useCallback(
    (file: File) => {
      setError(null);

      // Validate file type
      if (!file.type.startsWith('image/')) {
        setError(t('uploadErrorFormat'));
        setPhase('failed');
        return;
      }

      // Validate file size
      if (file.size > MAX_FILE_SIZE) {
        setError(t('uploadErrorSize', { size: formatFileSize(file.size) }));
        setPhase('failed');
        return;
      }

      setSelectedFile(file);
      setPhase('processing');

      // Create preview URL and assess quality.
      // Reading dimensions requires image decode (img.onload) which for a
      // phone-camera JPG is usually 50–300 ms — fast, but long enough that
      // a blank jump from upload button → ready feels uncertain. The
      // Framer progress-bar animation fills during this window.
      const url = URL.createObjectURL(file);
      setPreviewUrl(url);

      const img = new Image();
      img.onload = () => {
        const q = assessImageQuality(img.width, img.height, gridConfig);
        setQuality(q);
        setPhase('ready');
      };
      img.onerror = () => {
        setError(t('uploadErrorRead'));
        setPhase('failed');
      };
      img.src = url;
    },
    [gridConfig],
  );

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) processFile(file);
      // Reset input value so the same file can be re-selected
      e.target.value = '';
    },
    [processFile],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const file = e.dataTransfer.files?.[0];
      if (file) processFile(file);
    },
    [processFile],
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  function handleProceed() {
    if (selectedFile && phase === 'ready') {
      onImageSelected(selectedFile);
    }
  }

  function handleReset() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setSelectedFile(null);
    setPreviewUrl(null);
    setQuality(null);
    setError(null);
    setPhase('idle');
  }

  function handleRetry() {
    // From the failed state, just go back to idle — the user re-picks.
    setError(null);
    setPhase('idle');
  }

  const qualityConfig = {
    good: {
      label: t('qualityGood'),
      color: 'bg-success',
      textColor: 'text-success',
      width: 'w-full',
    },
    medium: {
      label: t('qualityMedium'),
      color: 'bg-gold',
      textColor: 'text-gold-dark',
      width: 'w-2/3',
    },
    low: {
      label: t('qualityLow'),
      color: 'bg-error',
      textColor: 'text-error',
      width: 'w-1/3',
    },
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="text-center">
        <h2 className="font-serif text-2xl font-bold text-charcoal md:text-3xl">
          {t('uploadTitle')}
        </h2>
      </div>

      {/* Hidden file inputs */}
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleFileChange}
        className="hidden"
        aria-hidden="true"
      />
      <input
        ref={galleryInputRef}
        type="file"
        accept="image/*"
        onChange={handleFileChange}
        className="hidden"
        aria-hidden="true"
      />

      <AnimatePresence mode="wait">
        {(phase === 'idle' || phase === 'failed') && (
          /* ── Upload Zone ── */
          <motion.div
            key="upload-zone"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.25 }}
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            className={[
              'relative flex flex-col items-center gap-6 rounded-2xl border-2 border-dashed p-8 md:p-12 transition-colors duration-200',
              phase === 'failed'
                ? 'border-error/60 bg-error/5'
                : isDragging
                  ? 'border-terracotta bg-terracotta/5'
                  : 'border-light-gray bg-white',
            ].join(' ')}
          >
            {/* Camera icon decoration */}
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-cream">
              <svg
                width="32"
                height="32"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="text-charcoal"
                aria-hidden="true"
              >
                <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z" />
                <circle cx="12" cy="13" r="4" />
              </svg>
            </div>

            {/* Action buttons */}
            <div className="flex w-full flex-col gap-3 sm:flex-row sm:justify-center">
              <button
                onClick={() => {
                  if (phase === 'failed') handleRetry();
                  cameraInputRef.current?.click();
                }}
                className={[
                  'flex min-h-[48px] items-center justify-center gap-2 rounded-xl px-6 py-3',
                  'bg-btn-primary text-btn-text font-medium text-base',
                  'transition-colors duration-200 hover:bg-btn-primary-hover active:bg-btn-primary-active',
                  'cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-btn-primary',
                  'sm:flex-1 sm:max-w-[200px]',
                ].join(' ')}
              >
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z" />
                  <circle cx="12" cy="13" r="4" />
                </svg>
                {t('takePhoto')}
              </button>

              <button
                onClick={() => {
                  if (phase === 'failed') handleRetry();
                  galleryInputRef.current?.click();
                }}
                className={[
                  'flex min-h-[48px] items-center justify-center gap-2 rounded-xl px-6 py-3',
                  'border-2 border-terracotta text-terracotta font-medium text-base',
                  'transition-colors duration-200 hover:bg-terracotta hover:text-white',
                  'cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-terracotta',
                  'sm:flex-1 sm:max-w-[200px]',
                ].join(' ')}
              >
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                  <circle cx="8.5" cy="8.5" r="1.5" />
                  <polyline points="21 15 16 10 5 21" />
                </svg>
                {t('chooseGallery')}
              </button>
            </div>

            {/* Accepted-format caption (only when idle; failed state replaces
                this area with the error line below so we don't double up) */}
            {phase === 'idle' && (
              <p className="flex flex-col items-center gap-1 text-center text-sm text-warm-gray">
                <span>{t('dragDrop')}</span>
                <span className="text-xs">{t('uploadFormatsHint')}</span>
              </p>
            )}

            {/* Drag overlay */}
            {isDragging && (
              <div className="absolute inset-0 flex items-center justify-center rounded-2xl bg-terracotta/10">
                <p className="text-lg font-semibold text-terracotta">
                  {t('dragDrop')}
                </p>
              </div>
            )}
          </motion.div>
        )}

        {phase === 'processing' && (
          /* ── Processing: perception cue while the browser decodes the
               image to pull dimensions + computes print-quality verdict.
               Typical path is 50–300 ms; the progress bar just keeps the
               hand-off feeling active. ── */
          <motion.div
            key="processing"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.2 }}
            className="flex flex-col items-center gap-4 rounded-2xl border-2 border-terracotta/30 bg-terracotta/5 p-8"
            role="status"
            aria-live="polite"
          >
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-terracotta/10">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="animate-pulse text-terracotta" aria-hidden="true">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <polyline points="21 15 16 10 5 21" />
              </svg>
            </div>
            <p className="text-sm font-medium text-charcoal">
              {t('uploadProcessing')}
            </p>
            <div className="h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-light-gray">
              <motion.div
                initial={{ width: '0%' }}
                animate={{ width: '100%' }}
                transition={{ duration: 0.6, ease: 'easeOut' }}
                className="h-full rounded-full bg-terracotta"
              />
            </div>
          </motion.div>
        )}

        {phase === 'ready' && selectedFile && (
          /* ── Preview & Quality Assessment ── */
          <motion.div
            key="preview"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.25 }}
            className="flex flex-col gap-5"
          >
            {/* Image preview thumbnail */}
            <div className="relative mx-auto overflow-hidden rounded-xl border-2 border-light-gray bg-white">
              {previewUrl && (
                <img
                  src={previewUrl}
                  alt="Preview"
                  className="h-48 w-full object-contain sm:h-64"
                />
              )}
              {/* Change photo — 48 px hit-target; always visible on photo.
                  Adds the full-width "Cambiar foto" link below for mobile
                  thumb reach, since the corner icon can be awkward to hit
                  one-handed on a large phone. */}
              <button
                onClick={handleReset}
                className="absolute right-2 top-2 flex h-12 w-12 items-center justify-center rounded-full bg-charcoal/60 text-white transition-colors hover:bg-charcoal/80 cursor-pointer"
                aria-label={t('replacePhoto')}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            {/* Mobile-only "Cambiar foto" link. Desktop has the corner icon;
                mobile benefits from a large-surface secondary action below
                the preview to avoid reaching the top-right of the image. */}
            <button
              type="button"
              onClick={handleReset}
              className="min-h-[44px] text-sm font-medium text-terracotta underline underline-offset-4 transition-colors hover:text-terracotta-dark cursor-pointer lg:hidden"
            >
              {t('replacePhoto')}
            </button>

            {/* File info */}
            <div className="flex items-center justify-between rounded-lg bg-white px-4 py-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-cream">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-charcoal">
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                    <circle cx="8.5" cy="8.5" r="1.5" />
                    <polyline points="21 15 16 10 5 21" />
                  </svg>
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-charcoal">
                    {selectedFile.name}
                  </p>
                  <p className="text-xs text-warm-gray">
                    {formatFileSize(selectedFile.size)}
                  </p>
                </div>
              </div>
            </div>

            {/* Quality meter */}
            {quality && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                className="flex flex-col gap-2 rounded-lg bg-white px-4 py-3"
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-charcoal">
                    {t('imageQuality')}
                  </span>
                  <span
                    className={`text-sm font-semibold ${qualityConfig[quality].textColor}`}
                  >
                    {qualityConfig[quality].label}
                  </span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-light-gray">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: '100%' }}
                    transition={{ duration: 0.6, ease: 'easeOut' }}
                    className={`h-full rounded-full ${qualityConfig[quality].color} ${qualityConfig[quality].width}`}
                  />
                </div>
                {quality === 'low' && (
                  <p className="flex items-center gap-1.5 text-xs text-error">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0">
                      <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                      <line x1="12" y1="9" x2="12" y2="13" />
                      <line x1="12" y1="17" x2="12.01" y2="17" />
                    </svg>
                    La imagen puede verse pixelada al imprimir. Te recomendamos usar una de mayor resolucion.
                  </p>
                )}
              </motion.div>
            )}

            {/* Proceed button */}
            <Button
              variant="primary"
              size="lg"
              fullWidth
              onClick={handleProceed}
            >
              {tc('next')}
            </Button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Error message */}
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
    </div>
  );
}
