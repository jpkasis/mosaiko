'use client';

import { useState, useCallback } from 'react';
import { ImageDropzone } from './ImageDropzone';
import { GridOverlayPreview } from './GridOverlayPreview';
import type { SeamDetectionResult } from '@/lib/admin/seam-detection';
import type { CategoryType } from '@/lib/customization-types';
import { CATALOG_CATEGORIES } from '@/lib/catalog-data';
import { GRID_CONFIGS, type GridSize } from '@/lib/grid-config';
import { Overlay, OverlayTitle } from '@/components/ui/Overlay';

interface ProductWizardProps {
  onClose: () => void;
  onSaved: () => void;
}

type WizardStep = 'upload' | 'analysis' | 'confirm' | 'details';

const STEP_LABELS: Record<WizardStep, string> = {
  upload: '1. Subir Imagen',
  analysis: '2. Analisis',
  confirm: '3. Confirmar',
  details: '4. Detalles',
};

export function ProductWizard({ onClose, onSaved }: ProductWizardProps) {
  const [step, setStep] = useState<WizardStep>('upload');
  const [isUploading, setIsUploading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Analysis state
  const [imageUrl, setImageUrl] = useState<string>('');
  const [tempImageKey, setTempImageKey] = useState<string>('');
  const [contentType, setContentType] = useState<string>('');
  const [detection, setDetection] = useState<SeamDetectionResult | null>(null);

  // Product details
  const [name, setName] = useState('');
  const [category, setCategory] = useState<CategoryType>('mosaicos');
  const [price, setPrice] = useState<number>(0);

  const handleFile = useCallback(async (file: File) => {
    setIsUploading(true);
    setStep('analysis');

    try {
      const formData = new FormData();
      formData.append('file', file);

      const res = await fetch('/api/admin/products/analyze', {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        // UAT-3 Phase 2 (Codex audit): admin analyze route now returns
        // `{ code, message }` instead of `{ error }`. Read both for
        // back-compat in case the response shape changes again.
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || err.error || 'Error al analizar');
      }

      const data = await res.json();
      setImageUrl(data.publicUrl);
      setTempImageKey(data.tempImageKey);
      setContentType(data.contentType);
      setDetection(data.detection);

      // Auto-fill price from grid config
      const gridSize = data.detection.gridSize as GridSize;
      if (GRID_CONFIGS[gridSize]) {
        setPrice(GRID_CONFIGS[gridSize].price);
      }

      setStep('confirm');
    } catch (err) {
      console.error(err);
      setStep('upload');
    } finally {
      setIsUploading(false);
    }
  }, []);

  const handleOverrideGrid = useCallback(async (rows: number, cols: number, gridSize: number) => {
    if (!tempImageKey) return;
    setIsUploading(true);
    setStep('analysis');

    try {
      // Re-analyze with forced grid parameters. The server still has
      // the temp image keyed by `tempImageKey`; we just need to send
      // the override grid values. (UAT-3 Phase 2 cleanup: removed an
      // unused outer `formData` declaration shadowed by the inner one.)
      const res = await fetch('/api/admin/products/analyze', {
        method: 'POST',
        body: (() => {
          const fd = new FormData();
          fd.append('forceRows', String(rows));
          fd.append('forceCols', String(cols));
          fd.append('forceGridSize', String(gridSize));
          return fd;
        })(),
      });

      // If the re-analysis without file fails, just update client-side
      if (!res.ok) {
        // Fallback: create synthetic detection with even seam positions
        const syntheticDetection: SeamDetectionResult = {
          gridSize: gridSize as GridSize,
          rows,
          cols,
          grid: `${cols}x${rows}`,
          confidence: 0.5,
          seamPositions: {
            vertical: Array.from({ length: cols - 1 }, (_, i) => (i + 1) / cols),
            horizontal: Array.from({ length: rows - 1 }, (_, i) => (i + 1) / rows),
          },
          seamWidthPercent: 0.005,
          imageWidth: detection?.imageWidth ?? 1000,
          imageHeight: detection?.imageHeight ?? 1000,
        };
        setDetection(syntheticDetection);
        if (GRID_CONFIGS[gridSize as GridSize]) {
          setPrice(GRID_CONFIGS[gridSize as GridSize].price);
        }
        setStep('confirm');
        return;
      }

      const data = await res.json();
      setDetection(data.detection);
      if (GRID_CONFIGS[data.detection.gridSize as GridSize]) {
        setPrice(GRID_CONFIGS[data.detection.gridSize as GridSize].price);
      }
      setStep('confirm');
    } catch {
      setStep('confirm');
    } finally {
      setIsUploading(false);
    }
  }, [tempImageKey, detection]);

  const handleSave = useCallback(async () => {
    if (!detection || !tempImageKey) return;
    setIsSaving(true);

    try {
      const pieces = detection.gridSize;
      const grid = detection.grid;
      const seamData = {
        vertical: detection.seamPositions.vertical,
        horizontal: detection.seamPositions.horizontal,
        widthPercent: detection.seamWidthPercent,
      };

      const res = await fetch('/api/admin/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          category,
          price,
          gridSize: detection.gridSize,
          grid,
          pieces,
          tempImageKey,
          seamData,
          contentType,
          detection,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Error al guardar');
      }

      onSaved();
    } catch (err) {
      console.error(err);
    } finally {
      setIsSaving(false);
    }
  }, [detection, tempImageKey, name, category, price, contentType, onSaved]);

  return (
    <Overlay
      open
      onOpenChange={(open) => { if (!open) onClose(); }}
      variant="modal-center"
      zLayer="modal"
      ariaLabel="Agregar producto"
      contentClassName="bg-white max-w-lg max-h-[90vh] overflow-hidden"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4" style={{ borderBottom: '1px solid #e5e0d4' }}>
        <OverlayTitle asChild>
          <h2 className="text-lg font-semibold text-charcoal" style={{ fontFamily: 'var(--font-cormorant), Georgia, serif' }}>
            Agregar Producto
          </h2>
        </OverlayTitle>
        <button onClick={onClose} className="flex h-12 w-12 cursor-pointer items-center justify-center rounded-lg text-warm-gray hover:bg-cream hover:text-charcoal" aria-label="Cerrar">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

        {/* Step indicator */}
        <div className="flex gap-1 px-6 py-3" style={{ borderBottom: '1px solid #e5e0d4' }}>
          {(Object.keys(STEP_LABELS) as WizardStep[]).map((s) => (
            <div key={s} className="flex-1">
              <div
                className={[
                  'h-1 rounded-full transition-colors',
                  s === step ? 'bg-terracotta'
                    : (Object.keys(STEP_LABELS) as WizardStep[]).indexOf(s) < (Object.keys(STEP_LABELS) as WizardStep[]).indexOf(step)
                      ? 'bg-terracotta/40'
                      : 'bg-warm-gray/20',
                ].join(' ')}
              />
              <span className={[
                'mt-1 block text-[10px]',
                s === step ? 'font-medium text-terracotta' : 'text-warm-gray/60',
              ].join(' ')}>
                {STEP_LABELS[s]}
              </span>
            </div>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {step === 'upload' && (
            <ImageDropzone onFile={handleFile} isUploading={isUploading} />
          )}

          {step === 'analysis' && (
            <div className="flex flex-col items-center justify-center py-12">
              <div className="h-10 w-10 animate-spin rounded-full border-4 border-warm-gray/20 border-t-terracotta" />
              <p className="mt-4 text-sm text-warm-gray">Analizando cuadricula...</p>
            </div>
          )}

          {step === 'confirm' && detection && (
            <div className="flex flex-col gap-4">
              <GridOverlayPreview
                imageUrl={imageUrl}
                detection={detection}
                onOverrideGrid={handleOverrideGrid}
              />
              <button
                onClick={() => setStep('details')}
                className="w-full rounded-lg bg-terracotta px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-terracotta/90"
              >
                Confirmar cuadricula
              </button>
            </div>
          )}

          {step === 'details' && (
            <div className="flex flex-col gap-4">
              {/* Name */}
              <div className="flex flex-col gap-1.5">
                <label htmlFor="product-name" className="text-xs font-medium text-warm-gray">Nombre del producto</label>
                <input
                  id="product-name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Ej: Mi Producto Personalizado"
                  className="rounded-lg bg-white px-3 py-2.5 text-sm text-charcoal placeholder:text-warm-gray/50"
                  style={{ border: '1px solid #e5e0d4' }}
                />
              </div>

              {/* Category */}
              <div className="flex flex-col gap-1.5">
                <label htmlFor="product-category" className="text-xs font-medium text-warm-gray">Categoria</label>
                <select
                  id="product-category"
                  value={category}
                  onChange={(e) => setCategory(e.target.value as CategoryType)}
                  className="rounded-lg bg-white px-3 py-2.5 text-sm text-charcoal"
                  style={{ border: '1px solid #e5e0d4' }}
                >
                  {CATALOG_CATEGORIES.map((cat) => (
                    <option key={cat.type} value={cat.type}>
                      {cat.type.charAt(0).toUpperCase() + cat.type.slice(1).replace(/-/g, ' ')}
                    </option>
                  ))}
                </select>
              </div>

              {/* Price */}
              <div className="flex flex-col gap-1.5">
                <label htmlFor="product-price" className="text-xs font-medium text-warm-gray">Precio (MXN)</label>
                <input
                  id="product-price"
                  type="number"
                  value={price}
                  onChange={(e) => setPrice(Number(e.target.value))}
                  min={0}
                  className="rounded-lg bg-white px-3 py-2.5 text-sm text-charcoal"
                  style={{ border: '1px solid #e5e0d4' }}
                />
              </div>

              {/* Grid info (read-only) */}
              {detection && (
                <div className="rounded-lg bg-cream px-3 py-2.5 text-xs text-warm-gray">
                  Cuadricula: {detection.grid} — {detection.gridSize} piezas — Confianza: {Math.round(detection.confidence * 100)}%
                </div>
              )}

              {/* Save button */}
              <button
                onClick={handleSave}
                disabled={isSaving || !name.trim()}
                className="w-full rounded-lg bg-terracotta px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-terracotta/90 disabled:opacity-50"
              >
                {isSaving ? 'Guardando...' : 'Guardar Producto'}
              </button>
            </div>
          )}
      </div>
    </Overlay>
  );
}
