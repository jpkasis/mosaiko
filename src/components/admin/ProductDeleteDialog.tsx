'use client';

import { useState } from 'react';
import { Overlay, OverlayTitle, OverlayDescription } from '@/components/ui/Overlay';

interface ProductDeleteDialogProps {
  productName: string;
  onConfirm: () => Promise<void>;
  onCancel: () => void;
}

export function ProductDeleteDialog({ productName, onConfirm, onCancel }: ProductDeleteDialogProps) {
  const [isDeleting, setIsDeleting] = useState(false);

  async function handleDelete() {
    setIsDeleting(true);
    await onConfirm();
    setIsDeleting(false);
  }

  return (
    <Overlay
      open
      onOpenChange={(open) => { if (!open) onCancel(); }}
      variant="modal-center"
      zLayer="modal"
      ariaLabel="Eliminar producto"
      contentClassName="bg-white p-6 max-w-sm"
      closeOnOverlayClick={!isDeleting}
      closeOnEscape={!isDeleting}
    >
      <OverlayTitle asChild>
        <h3 className="text-lg font-semibold text-charcoal" style={{ fontFamily: 'var(--font-cormorant), Georgia, serif' }}>
          Eliminar producto
        </h3>
      </OverlayTitle>
      <OverlayDescription asChild>
        <p className="mt-2 text-sm text-warm-gray">
          ¿Estas seguro de eliminar <strong className="text-charcoal">{productName}</strong>?
          Esta accion no se puede deshacer.
        </p>
      </OverlayDescription>

      <div className="mt-6 flex gap-3">
        <button
          onClick={onCancel}
          disabled={isDeleting}
          className="flex-1 min-h-[44px] rounded-lg px-4 py-2.5 text-sm font-medium text-warm-gray transition-colors hover:bg-cream"
          style={{ border: '1px solid #e5e0d4' }}
        >
          Cancelar
        </button>
        <button
          onClick={handleDelete}
          disabled={isDeleting}
          className="flex-1 min-h-[44px] rounded-lg bg-red-500 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-red-600 disabled:opacity-50"
        >
          {isDeleting ? 'Eliminando...' : 'Eliminar'}
        </button>
      </div>
    </Overlay>
  );
}
