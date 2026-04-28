'use client';

import { useState, useEffect } from 'react';
import { Overlay, OverlayTitle, OverlayDescription } from '@/components/ui/Overlay';

const ONBOARDING_KEY = 'mosaiko-admin-onboarding-seen';

const STEPS = [
  {
    title: 'Tus pedidos aparecen aquí',
    description: 'Cuando un cliente compra, su pedido aparece automáticamente en esta lista con todos los detalles.',
    icon: (
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#7b3f1e" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z" />
        <line x1="3" y1="6" x2="21" y2="6" />
        <path d="M16 10a4 4 0 01-8 0" />
      </svg>
    ),
  },
  {
    title: 'Haz clic para ver detalles',
    description: 'Cada tarjeta de pedido te muestra la vista previa, el tipo de mosaico y el estado. Haz clic para ver todo.',
    icon: (
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#7b3f1e" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
        <circle cx="12" cy="12" r="3" />
      </svg>
    ),
  },
  {
    title: 'Descarga archivos de impresión',
    description: 'En cada pedido encontrarás las piezas listas para imprimir. Descárgalas individualmente o todas en un ZIP.',
    icon: (
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#7b3f1e" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
        <polyline points="7 10 12 15 17 10" />
        <line x1="12" y1="15" x2="12" y2="3" />
      </svg>
    ),
  },
  {
    title: 'Actualiza el estado del pedido',
    description: 'Marca como "Imprimiendo" cuando empieces, "Enviado" cuando lo mandes (ingresa la guía), y "Entregado" cuando confirmes.',
    icon: (
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#7b3f1e" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
        <polyline points="22 4 12 14.01 9 11.01" />
      </svg>
    ),
  },
];

export function OnboardingOverlay() {
  const [isVisible, setIsVisible] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [dontShowAgain, setDontShowAgain] = useState(false);

  useEffect(() => {
    const seen = localStorage.getItem(ONBOARDING_KEY);
    if (!seen) {
      setIsVisible(true);
    }
  }, []);

  function handleDismiss() {
    if (dontShowAgain) {
      localStorage.setItem(ONBOARDING_KEY, 'true');
    }
    setIsVisible(false);
  }

  function handleNext() {
    if (currentStep < STEPS.length - 1) {
      setCurrentStep(currentStep + 1);
    } else {
      localStorage.setItem(ONBOARDING_KEY, 'true');
      setIsVisible(false);
    }
  }

  const step = STEPS[currentStep];

  return (
    <Overlay
      open={isVisible}
      onOpenChange={(open) => { if (!open) handleDismiss(); }}
      variant="modal-center"
      zLayer="modal"
      ariaLabel="Tutorial de administración"
      contentClassName="bg-white p-8 max-w-md"
    >
      {/* Step indicator */}
      <div className="mb-6 flex items-center justify-center gap-2">
        {STEPS.map((_, i) => (
          <div
            key={i}
            className={[
              'h-1.5 rounded-full transition-all',
              i === currentStep ? 'w-6 bg-terracotta' : 'w-1.5 bg-light-gray',
            ].join(' ')}
          />
        ))}
      </div>

      {/* Content */}
      <div className="text-center">
        <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-terracotta/10">
          {step.icon}
        </div>

        <OverlayTitle
          asChild
        >
          <h3
            className="text-xl font-semibold text-charcoal"
            style={{ fontFamily: 'var(--font-cormorant), Georgia, serif' }}
          >
            {step.title}
          </h3>
        </OverlayTitle>
        <OverlayDescription asChild>
          <p className="mt-2 text-sm leading-relaxed text-warm-gray">
            {step.description}
          </p>
        </OverlayDescription>
      </div>

      {/* Actions */}
      <div className="mt-8 flex flex-col gap-3">
        <button
          onClick={handleNext}
          className="flex min-h-[48px] w-full cursor-pointer items-center justify-center rounded-lg font-semibold text-white transition-colors"
          style={{ backgroundColor: '#7b3f1e' }}
        >
          {currentStep < STEPS.length - 1 ? 'Siguiente' : 'Entendido'}
        </button>

        <div className="flex items-center justify-between">
          <label className="flex items-center gap-2 text-xs text-warm-gray">
            <input
              type="checkbox"
              checked={dontShowAgain}
              onChange={(e) => setDontShowAgain(e.target.checked)}
              className="rounded"
            />
            No mostrar de nuevo
          </label>
          <button
            onClick={handleDismiss}
            className="cursor-pointer text-xs text-warm-gray hover:text-charcoal"
          >
            Saltar
          </button>
        </div>
      </div>
    </Overlay>
  );
}
