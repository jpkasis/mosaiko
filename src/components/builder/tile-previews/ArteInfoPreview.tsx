'use client';

interface ArteInfoPreviewProps {
  title?: string;
  artist?: string;
  year?: string;
  className?: string;
}

function wrapTitle(title: string, budget = 14): [string, string?] {
  const t = title.trim();
  if (t.length <= budget) return [t];
  const slice = t.slice(0, budget + 1);
  const lastSpace = slice.lastIndexOf(' ');
  if (lastSpace <= 0) return [t.slice(0, budget), t.slice(budget)];
  return [t.slice(0, lastSpace), t.slice(lastSpace + 1)];
}

/**
 * Client-side preview of the Arte info tile (tile 9, bottom-right).
 * Mirrors the print pipeline output from processors/arte.ts.
 * Typography per client spec (art-instructions.md): Montserrat Bold for title,
 * Montserrat Regular for "Artist, c. Year". Layout matches stock references in
 * MOSAIKO-images/Categoria Arte/*.png.
 */
export function ArteInfoPreview({
  title = '',
  artist = '',
  year = '',
  className,
}: ArteInfoPreviewProps) {
  const [line1, line2] = wrapTitle((title || '—').toUpperCase());
  const artistLine = year ? (artist ? `${artist}, c. ${year}` : `c. ${year}`) : artist;

  return (
    <div
      className={['relative h-full w-full overflow-hidden rounded-md', className].filter(Boolean).join(' ')}
      style={{
        backgroundColor: '#000000',
        aspectRatio: '1',
        containerType: 'inline-size',
      }}
    >
      <div
        className="absolute"
        style={{
          top: '22%',
          left: '12%',
          right: '12%',
          fontFamily: 'var(--font-montserrat), Montserrat, sans-serif',
          fontWeight: 700,
          color: '#FFFFFF',
          fontSize: 'clamp(8px, 10cqi, 20px)',
          lineHeight: 1.12,
          letterSpacing: '0.01em',
          textTransform: 'uppercase',
        }}
      >
        <div>{line1}</div>
        {line2 && <div>{line2}</div>}
      </div>

      <div
        className="absolute"
        style={{
          top: line2 ? '52%' : '36%',
          left: '12%',
          right: '12%',
          fontFamily: 'var(--font-montserrat), Montserrat, sans-serif',
          fontWeight: 400,
          color: '#CCCCCC',
          fontSize: 'clamp(6px, 7cqi, 13px)',
          lineHeight: 1.2,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {artistLine || '\u00A0'}
      </div>

      <img
        src="/logos/logo-blanco.png"
        alt="Mosaiko"
        className="pointer-events-none absolute -translate-x-1/2"
        style={{
          left: '50%',
          bottom: '10%',
          height: 'clamp(7px, 8cqi, 16px)',
          width: 'auto',
          opacity: 0.9,
        }}
        draggable={false}
      />
    </div>
  );
}
