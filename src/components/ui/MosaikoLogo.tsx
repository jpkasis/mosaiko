import Image from 'next/image';

interface MosaikoLogoProps {
  /** 'dark' uses logo-dark.png (for light backgrounds), 'light' uses logo-white.png (for dark backgrounds) */
  variant?: 'dark' | 'light';
  /** Size of the M icon in px */
  size?: number;
  /** Additional className for the wrapper */
  className?: string;
}

/**
 * Mosaiko brand logo: stylized M icon + lowercase "osaiko" text.
 * Text is baseline-aligned to the bottom of the M mark, with tight spacing.
 */
export function MosaikoLogo({ variant = 'dark', size = 28, className }: MosaikoLogoProps) {
  const src = variant === 'dark' ? '/logos/logo-dark.png' : '/logos/logo-white.png';
  const textColor = variant === 'dark' ? 'text-charcoal' : 'text-cream';

  // Scale the text size proportionally to the icon
  const textSize = Math.round(size * 0.71); // ~20px at 28px icon

  return (
    // The M icon + visible "osaiko" text together form the wordmark.
    // Screen readers only need to announce "Mosaiko" once, so the image
    // is marked decorative (alt="") and the wrapper carries the
    // accessible label + the visible "osaiko" text via aria-hidden so
    // AT reads the label, not both.
    <span
      className={['inline-flex items-end', className].filter(Boolean).join(' ')}
      style={{ gap: `${size * 0.07}px` }}
      role="img"
      aria-label="Mosaiko"
    >
      <Image
        src={src}
        alt=""
        width={size}
        height={size}
        className="shrink-0"
        style={{ width: `${size}px`, height: `${size}px` }}
        priority
        unoptimized
      />
      <span
        aria-hidden="true"
        className={`font-bold font-brand tracking-tight leading-none ${textColor}`}
        style={{ fontSize: `${textSize}px`, marginBottom: `${size * 0.04}px` }}
      >
        osaiko
      </span>
    </span>
  );
}
