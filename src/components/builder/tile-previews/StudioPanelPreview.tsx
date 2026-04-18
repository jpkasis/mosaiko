'use client';

interface StudioPanelPreviewProps {
  label: 'studio-left' | 'studio-right';
  year?: string;
  japaneseText?: string;
  customText?: string;
  studioText?: string;
  className?: string;
}

/**
 * Studio text panels (tiles 5-6).
 * PNG template background + Montserrat text.
 * Positioning measured from pre-made product pixel analysis (chihiro, howl, totoro):
 *   Left:  year 27%, studioText 35%, left 7%
 *   Right: japaneseText 27%, customText 36%, right 7%
 *   Font:  ~7% of tile width (46px on 664px product tiles)
 */
export function StudioPanelPreview({
  label,
  year = '',
  japaneseText = '',
  customText = '',
  studioText = '',
  className,
}: StudioPanelPreviewProps) {
  const isLeft = label === 'studio-left';
  const tileNum = isLeft ? 5 : 6;

  const textStyle: React.CSSProperties = {
    fontFamily: 'var(--font-montserrat), Montserrat, sans-serif',
    fontSize: 'clamp(10px, 7cqi, 24px)',
    color: '#2a2a2a',
    lineHeight: 1,
  };

  return (
    <div
      className={['relative h-full w-full overflow-hidden', className].filter(Boolean).join(' ')}
      style={{ aspectRatio: '1', backgroundColor: 'transparent', containerType: 'inline-size' }}
    >
      {/* PNG template background */}
      <img
        src={`/templates/studio/${tileNum}.png`}
        alt=""
        className="absolute inset-0 h-full w-full"
        style={{ objectFit: 'fill' }}
        draggable={false}
      />

      {isLeft ? (
        /* Left panel: year + studioText */
        <>
          <span
            className="absolute"
            style={{ ...textStyle, top: '27%', left: '7%', fontWeight: 400 }}
          >
            {year || '(Año)'}
          </span>
          <span
            className="absolute"
            style={{ ...textStyle, top: '35%', left: '7%', fontWeight: 400 }}
          >
            {studioText || 'STUDIO GHIBLI'}
          </span>
        </>
      ) : (
        /* Right panel: japaneseText + customText + logo */
        <>
          <span
            className="absolute text-right"
            style={{ ...textStyle, top: '27%', right: '7%', fontWeight: 400 }}
          >
            {japaneseText || '(テキスト)'}
          </span>
          <span
            className="absolute text-right"
            style={{ ...textStyle, top: '36%', right: '7%', fontWeight: 700 }}
          >
            {customText || '(Tu Texto)'}
          </span>
          {/* Mosaiko logo at bottom-right (matches products at ~82% from top) */}
          <img
            src="/logos/logo-negro.png"
            alt="Mosaiko"
            className="pointer-events-none absolute"
            style={{
              right: '5%',
              top: '82%',
              height: 'clamp(10px, 7cqi, 22px)',
              width: 'auto',
              opacity: 0.6,
            }}
            draggable={false}
          />
        </>
      )}
    </div>
  );
}
