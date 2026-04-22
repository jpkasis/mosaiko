'use client';

/**
 * `Overlay` — the single primitive every full-screen / fixed-layer surface
 * in the app is built on top of.
 *
 * Historically, Mosaiko had eight independent surfaces (cart drawer,
 * mobile nav, cookie banner, admin onboarding, three admin dialogs, admin
 * sidebar) each reinventing body-scroll lock, focus trap, ESC handling,
 * ARIA, z-index, and Framer variants. Now they all compose this component
 * on top of Radix Dialog (scroll lock via `react-remove-scroll`, focus
 * trap, ESC handling, ARIA) and the z-index CSS tokens introduced in PR 0.
 *
 * Variants correspond to the four physical shapes the product needs:
 *   - `drawer-right`  — cart drawer, mobile nav
 *   - `drawer-left`   — admin sidebar (mobile)
 *   - `drawer-bottom` — cookie banner, mobile live preview (PR 3)
 *   - `modal-center`  — confirm dialogs, product wizard, onboarding
 *
 * `zLayer` picks which CSS variable governs stacking order so nested
 * overlays (e.g. a confirm dialog opened from inside the cart drawer) land
 * above their parent without magic numbers.
 */
import { type ReactNode, useMemo } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';

function cx(...parts: Array<string | undefined | false | null>): string {
  return parts.filter(Boolean).join(' ');
}

export type OverlayVariant =
  | 'drawer-right'
  | 'drawer-left'
  | 'drawer-bottom'
  | 'modal-center';

export type OverlayZLayer = 'drawer' | 'modal' | 'cookie' | 'toast';

export interface OverlayProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  variant: OverlayVariant;
  /** Picks the CSS z-index token. Defaults to `modal`. */
  zLayer?: OverlayZLayer;
  /** ARIA label for the dialog. Required for accessibility. */
  ariaLabel: string;
  /** Optional: element id whose content describes the dialog. */
  ariaDescribedBy?: string;
  /** Close when the user clicks outside the content. Defaults to true. */
  closeOnOverlayClick?: boolean;
  /** Close when the user presses Escape. Defaults to true. */
  closeOnEscape?: boolean;
  /** Optional className applied to the content pane. */
  contentClassName?: string;
  /** Optional inline style applied to the content pane (rare — prefer className). */
  contentStyle?: React.CSSProperties;
  /** Hide the overlay backdrop (useful for non-modal surfaces like the announcement bar). */
  hideBackdrop?: boolean;
  children: ReactNode;
}

/**
 * Tailwind classes for each variant's position + size envelope.
 * Safe-area padding is expected to be applied inside children (via the
 * `.pt-safe` / `.pb-safe` utilities from PR 0) where it matters.
 */
const CONTENT_CLASSES: Record<OverlayVariant, string> = {
  'drawer-right':
    'fixed right-0 top-0 h-full w-full bg-cream shadow-2xl sm:max-w-[420px] flex flex-col outline-none',
  'drawer-left':
    'fixed left-0 top-0 h-full w-full bg-cream shadow-2xl sm:max-w-[320px] flex flex-col outline-none',
  'drawer-bottom':
    'fixed inset-x-0 bottom-0 max-h-[85vh] bg-cream shadow-2xl rounded-t-2xl flex flex-col outline-none',
  'modal-center':
    'fixed left-1/2 top-1/2 w-[calc(100vw-2rem)] max-w-[480px] -translate-x-1/2 -translate-y-1/2 bg-cream rounded-2xl shadow-2xl flex flex-col outline-none',
};

function buildContentVariants(variant: OverlayVariant, reduced: boolean) {
  if (reduced) {
    return {
      hidden: { opacity: 0 },
      visible: { opacity: 1, transition: { duration: 0.1 } },
      exit: { opacity: 0, transition: { duration: 0.1 } },
    };
  }
  switch (variant) {
    case 'drawer-right':
      return {
        hidden: { x: '100%' },
        visible: {
          x: 0,
          transition: { type: 'spring' as const, stiffness: 300, damping: 30 },
        },
        exit: {
          x: '100%',
          transition: { type: 'spring' as const, stiffness: 300, damping: 30 },
        },
      };
    case 'drawer-left':
      return {
        hidden: { x: '-100%' },
        visible: {
          x: 0,
          transition: { type: 'spring' as const, stiffness: 300, damping: 30 },
        },
        exit: {
          x: '-100%',
          transition: { type: 'spring' as const, stiffness: 300, damping: 30 },
        },
      };
    case 'drawer-bottom':
      return {
        hidden: { y: '100%' },
        visible: {
          y: 0,
          transition: { type: 'spring' as const, stiffness: 260, damping: 28 },
        },
        exit: {
          y: '100%',
          transition: { type: 'spring' as const, stiffness: 260, damping: 28 },
        },
      };
    case 'modal-center':
      return {
        hidden: { opacity: 0, scale: 0.96, y: 4 },
        visible: {
          opacity: 1,
          scale: 1,
          y: 0,
          transition: { duration: 0.2, ease: [0.16, 1, 0.3, 1] as const },
        },
        exit: {
          opacity: 0,
          scale: 0.96,
          y: 4,
          transition: { duration: 0.15, ease: [0.16, 1, 0.3, 1] as const },
        },
      };
  }
}

const OVERLAY_VARIANTS = {
  hidden: { opacity: 0 },
  visible: { opacity: 1 },
  exit: { opacity: 0 },
} as const;

export function Overlay({
  open,
  onOpenChange,
  variant,
  zLayer = 'modal',
  ariaLabel,
  ariaDescribedBy,
  closeOnOverlayClick = true,
  closeOnEscape = true,
  contentClassName,
  contentStyle,
  hideBackdrop = false,
  children,
}: OverlayProps) {
  const reduced = useReducedMotion() ?? false;
  const contentVariants = useMemo(
    () => buildContentVariants(variant, reduced),
    [variant, reduced],
  );
  const zIndex = `var(--z-${zLayer})`;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <AnimatePresence>
        {open && (
          <Dialog.Portal forceMount>
            {!hideBackdrop && (
              <Dialog.Overlay asChild>
                <motion.div
                  variants={OVERLAY_VARIANTS}
                  initial="hidden"
                  animate="visible"
                  exit="exit"
                  transition={{ duration: 0.2 }}
                  className="fixed inset-0 bg-charcoal/50 backdrop-blur-[2px]"
                  style={{ zIndex }}
                />
              </Dialog.Overlay>
            )}
            <Dialog.Content
              asChild
              aria-label={ariaLabel}
              aria-describedby={ariaDescribedBy}
              onEscapeKeyDown={(e) => {
                if (!closeOnEscape) e.preventDefault();
              }}
              onPointerDownOutside={(e) => {
                if (!closeOnOverlayClick) e.preventDefault();
              }}
              onInteractOutside={(e) => {
                if (!closeOnOverlayClick) e.preventDefault();
              }}
            >
              <motion.div
                variants={contentVariants}
                initial="hidden"
                animate="visible"
                exit="exit"
                className={cx(CONTENT_CLASSES[variant], contentClassName)}
                style={{
                  ...contentStyle,
                  zIndex: `calc(${zIndex} + 1)`,
                }}
              >
                {children}
              </motion.div>
            </Dialog.Content>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  );
}

/**
 * Convenience re-exports so consumers can build a `<Dialog.Title>` inside
 * the overlay for proper Radix a11y without importing the library twice.
 */
export const OverlayTitle = Dialog.Title;
export const OverlayDescription = Dialog.Description;
export const OverlayClose = Dialog.Close;
