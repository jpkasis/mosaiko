'use client';

import Image from 'next/image';

interface MosaikoWatermarkProps {
  /** Colour of the M icon and "osaiko" text. Default 'dark'. */
  variant?: 'dark' | 'white';
}

/**
 * Small Mosaiko logo watermark for the bottom-right corner of mosaic previews.
 * Matches the branding seen on product photos: M icon + lowercase "osaiko".
 * Positioned absolutely within the tile grid container.
 */
export function MosaikoWatermark({ variant = 'dark' }: MosaikoWatermarkProps = {}) {
  const isWhite = variant === 'white';
  const src = isWhite ? '/logos/logo-white.png' : '/logos/logo-dark.png';
  const textClass = isWhite ? 'text-white' : 'text-charcoal';
  return (
    <div
      className="pointer-events-none absolute bottom-1 right-1 z-20 flex items-end opacity-70"
      style={{ gap: '1px' }}
      aria-hidden="true"
    >
      <Image
        src={src}
        alt=""
        width={14}
        height={14}
        className="shrink-0"
        style={{ width: '14px', height: '14px' }}
        unoptimized
      />
      <span
        className={`font-bold font-brand leading-none ${textClass}`}
        style={{ fontSize: '10px', marginBottom: '0.5px' }}
      >
        osaiko
      </span>
    </div>
  );
}
