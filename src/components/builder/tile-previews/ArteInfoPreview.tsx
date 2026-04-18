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
 * Typography per client spec (art-instructions.md): Montserrat Bold title,
 * Montserrat Regular "Artist, c. Year". Layout matches stock references in
 * MOSAIKO-images/Categoria Arte/*.png.
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
          top: '14%',
          left: '18%',
          right: '10%',
          bottom: '22%',
          zIndex: 1,
          display: 'flex',
          flexDirection: 'column',
          gap: 'clamp(3px, 2cqi, 8px)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            fontFamily: 'var(--font-montserrat), Montserrat, sans-serif',
            fontWeight: 700,
            color: '#FFFFFF',
            fontSize: 'clamp(7px, 13cqi, 26px)',
            lineHeight: 1.08,
            letterSpacing: '0.01em',
            textTransform: 'uppercase',
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
            fontSize: 'clamp(5px, 9cqi, 17px)',
            lineHeight: 1.25,
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
          bottom: '7%',
          height: 'clamp(8px, 7cqi, 16px)',
          width: 'auto',
          opacity: 0.9,
          zIndex: 2,
        }}
        draggable={false}
      />
    </div>
  );
}
