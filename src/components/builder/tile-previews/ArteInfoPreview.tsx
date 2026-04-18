'use client';

import { wrapTitle, wrapArtist } from '@/lib/print-pipeline/utils/text-wrap';

interface ArteInfoPreviewProps {
  title?: string;
  artist?: string;
  year?: string;
  className?: string;
}

/**
 * Client-side preview of the Arte info tile (tile 9, bottom-right).
 * Mirrors the print pipeline output from processors/arte.ts.
 * Typography per client spec (art-instructions.md) + stock measurement
 * (MOSAIKO-images/Categoria Arte/*.png): Montserrat Bold title and
 * Montserrat Regular artist line, both right-aligned in the upper ~25%
 * of the tile. Logo tucked in bottom-right corner.
 */
export function ArteInfoPreview({
  title = '',
  artist = '',
  year = '',
  className,
}: ArteInfoPreviewProps) {
  const trimmedTitle = title.trim();
  const trimmedArtist = artist.trim();
  const trimmedYear = year.trim();
  const titleLines = wrapTitle(trimmedTitle || '—');
  const artistRaw = trimmedYear
    ? trimmedArtist
      ? `${trimmedArtist}, c. ${trimmedYear}`
      : `c. ${trimmedYear}`
    : trimmedArtist;
  const artistLines = artistRaw ? wrapArtist(artistRaw) : [''];

  return (
    <div
      className={['relative h-full w-full overflow-hidden rounded-md', className].filter(Boolean).join(' ')}
      style={{
        aspectRatio: '1',
        containerType: 'inline-size',
        contain: 'layout paint',
        isolation: 'isolate',
        backgroundColor: '#000000',
      }}
    >
      <div
        aria-hidden="true"
        className="absolute inset-0"
        style={{ backgroundColor: '#000000', zIndex: 0 }}
      />

      <div
        className="absolute"
        style={{
          top: '10%',
          left: '14%',
          right: '12%',
          zIndex: 1,
          display: 'flex',
          flexDirection: 'column',
          gap: 'clamp(2px, 1.5cqi, 6px)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            fontFamily: 'var(--font-montserrat), Montserrat, sans-serif',
            fontWeight: 700,
            color: '#FFFFFF',
            fontSize: 'clamp(5px, 8cqi, 30px)',
            lineHeight: 1.1,
            letterSpacing: '0.01em',
            textTransform: 'uppercase',
            textAlign: 'right',
          }}
        >
          {titleLines.map((line, i) => (
            <div key={i}>{line}</div>
          ))}
        </div>

        <div
          style={{
            fontFamily: 'var(--font-montserrat), Montserrat, sans-serif',
            fontWeight: 400,
            color: '#E5E5E5',
            fontSize: 'clamp(4px, 5cqi, 20px)',
            lineHeight: 1.25,
            textAlign: 'right',
          }}
        >
          {artistLines.map((line, i) => (
            <div key={i}>{line || '\u00A0'}</div>
          ))}
        </div>
      </div>

      <img
        src="/logos/logo-blanco.png"
        alt=""
        aria-hidden="true"
        className="pointer-events-none absolute"
        style={{
          right: '8%',
          bottom: '6%',
          height: 'clamp(7px, 8cqi, 22px)',
          width: 'auto',
          opacity: 0.9,
          zIndex: 2,
        }}
        draggable={false}
      />
    </div>
  );
}
