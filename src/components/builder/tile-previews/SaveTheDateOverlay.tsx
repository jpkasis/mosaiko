'use client';

import {
  STD_FONT_CSS_VARS,
  hexLuminance,
  type STDFontFamily,
  type STDAnchor,
  type STDSize,
  type STDTextTreatment,
} from '@/lib/customization-types';

interface SaveTheDateOverlayProps {
  eventText?: string;
  date?: string;
  fontFamily: STDFontFamily;
  fontSize: STDSize;
  color: string;
  anchor: STDAnchor;
  treatment: STDTextTreatment;
  className?: string;
}

/**
 * Single unified overlay covering the full 3×3 STD mosaic.
 * Positions a text block at one of 9 anchor points with user-controlled
 * font, size, color, and invitation-grade readability treatment.
 *
 * Wrapping: `white-space: pre` — text only breaks on the user's
 * explicit `\n`s. No auto-wrap. Users insert line breaks via the Enter
 * key in the textarea input.
 */
export function SaveTheDateOverlay({
  eventText = '',
  date = '',
  fontFamily,
  fontSize,
  color,
  anchor,
  treatment,
  className,
}: SaveTheDateOverlayProps) {
  const resolvedEventText = eventText.length > 0 ? eventText : 'Save the Date';
  const resolvedDate = formatDateForDisplay(date);

  const pos = ANCHOR_POSITION[anchor];
  const eventFontSize = EVENT_SIZE[fontSize];
  const dateFontSize = DATE_SIZE[fontSize];
  const textIsLight = hexLuminance(color) >= 0.6;

  const treatmentEl = renderTreatment(treatment, color, textIsLight, {
    fontFamily,
    eventFontSize,
    dateFontSize,
    eventText: resolvedEventText,
    date: resolvedDate,
  });

  return (
    <div
      className={['pointer-events-none absolute inset-0', className].filter(Boolean).join(' ')}
      style={{ containerType: 'inline-size' }}
    >
      <div
        className="absolute"
        style={{
          ...pos.containerStyle,
          textAlign: pos.textAlign,
        }}
      >
        {treatmentEl}
      </div>
    </div>
  );
}

interface TextProps {
  fontFamily: STDFontFamily;
  eventFontSize: string;
  dateFontSize: string;
  eventText: string;
  date: string;
}

function TextBlock({ fontFamily, eventFontSize, dateFontSize, eventText, date, extraStyle, dateExtraStyle }: TextProps & { extraStyle?: React.CSSProperties; dateExtraStyle?: React.CSSProperties }) {
  return (
    <>
      <span
        style={{
          display: 'block',
          fontFamily: STD_FONT_CSS_VARS[fontFamily],
          fontSize: eventFontSize,
          color: 'currentColor',
          fontWeight: 400,
          lineHeight: 1.15,
          letterSpacing: '0.02em',
          whiteSpace: 'pre',
          ...extraStyle,
        }}
      >
        {eventText}
      </span>
      {date && (
        <span
          style={{
            display: 'block',
            marginTop: 'clamp(2px, 1cqi, 10px)',
            fontFamily: STD_FONT_CSS_VARS[fontFamily],
            fontSize: dateFontSize,
            color: 'currentColor',
            fontWeight: 400,
            lineHeight: 1.2,
            letterSpacing: '0.06em',
            opacity: 0.92,
            whiteSpace: 'pre',
            ...extraStyle,
            ...dateExtraStyle,
          }}
        >
          {date}
        </span>
      )}
    </>
  );
}

function renderTreatment(
  treatment: STDTextTreatment,
  textColor: string,
  textIsLight: boolean,
  text: TextProps,
): React.ReactElement {
  const baseColor = { color: textColor };

  switch (treatment) {
    case 'none':
      return (
        <div style={{ display: 'inline-block', ...baseColor }}>
          <TextBlock {...text} />
        </div>
      );

    case 'shadow':
      return (
        <div style={{ display: 'inline-block', ...baseColor }}>
          <TextBlock
            {...text}
            extraStyle={{
              textShadow:
                '0 2px 8px rgba(0,0,0,0.75), 0 0 12px rgba(0,0,0,0.35), 0 1px 2px rgba(0,0,0,0.6)',
            }}
          />
        </div>
      );

    case 'outline': {
      const strokeColor = textIsLight ? 'rgba(0,0,0,0.8)' : 'rgba(255,255,255,0.9)';
      return (
        <div style={{ display: 'inline-block', ...baseColor }}>
          <TextBlock
            {...text}
            extraStyle={{
              WebkitTextStroke: `clamp(0.5px, 0.28cqi, 1.8px) ${strokeColor}`,
              paintOrder: 'stroke fill',
              textShadow: '0 1px 3px rgba(0,0,0,0.35)',
            } as React.CSSProperties}
          />
        </div>
      );
    }

    case 'card': {
      const fill = textIsLight ? 'rgba(22,22,26,0.88)' : 'rgba(250,248,242,0.94)';
      const innerBorder = textIsLight ? 'rgba(255,255,255,0.22)' : 'rgba(0,0,0,0.18)';
      return (
        <div
          style={{
            position: 'relative',
            display: 'inline-block',
            padding: 'clamp(10px, 3cqi, 28px) clamp(16px, 4cqi, 40px)',
            backgroundColor: fill,
            boxShadow:
              '0 4px 24px rgba(0,0,0,0.2), 0 1px 3px rgba(0,0,0,0.14)',
            borderRadius: 0,
            ...baseColor,
          }}
        >
          <div
            aria-hidden
            style={{
              position: 'absolute',
              inset: 'clamp(4px, 1cqi, 9px)',
              border: `1px solid ${innerBorder}`,
              pointerEvents: 'none',
            }}
          />
          <TextBlock {...text} />
        </div>
      );
    }

    case 'frame': {
      const outer = textIsLight ? 'rgba(255,255,255,0.75)' : 'rgba(30,28,24,0.75)';
      const inner = textIsLight ? 'rgba(255,255,255,0.45)' : 'rgba(30,28,24,0.45)';
      return (
        <div
          style={{
            position: 'relative',
            display: 'inline-block',
            padding: 'clamp(12px, 3.5cqi, 34px) clamp(18px, 5cqi, 48px)',
            ...baseColor,
          }}
        >
          <div
            aria-hidden
            style={{
              position: 'absolute',
              inset: 0,
              border: `1px solid ${outer}`,
              pointerEvents: 'none',
            }}
          />
          <div
            aria-hidden
            style={{
              position: 'absolute',
              inset: 'clamp(4px, 1cqi, 9px)',
              border: `1px solid ${inner}`,
              pointerEvents: 'none',
            }}
          />
          <TextBlock
            {...text}
            extraStyle={{ textShadow: '0 1px 3px rgba(0,0,0,0.35)' }}
          />
        </div>
      );
    }
  }
}

function formatDateForDisplay(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const day = String(d.getUTCDate()).padStart(2, '0');
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const year = d.getUTCFullYear();
  return `${day}.${month}.${year}`;
}

const EVENT_SIZE: Record<STDSize, string> = {
  S: 'clamp(10px, 6.5cqi, 42px)',
  M: 'clamp(12px, 8cqi, 56px)',
  L: 'clamp(15px, 10cqi, 72px)',
};

const DATE_SIZE: Record<STDSize, string> = {
  S: 'clamp(6px, 3.5cqi, 20px)',
  M: 'clamp(8px, 4.5cqi, 26px)',
  L: 'clamp(10px, 5.5cqi, 32px)',
};

type AnchorStyle = {
  containerStyle: React.CSSProperties;
  textAlign: 'left' | 'center' | 'right';
};

const EDGE = '6%';
const MID = '50%';

const ANCHOR_POSITION: Record<STDAnchor, AnchorStyle> = {
  'top-left': {
    containerStyle: { top: EDGE, left: EDGE },
    textAlign: 'left',
  },
  'top-center': {
    containerStyle: { top: EDGE, left: MID, transform: 'translateX(-50%)' },
    textAlign: 'center',
  },
  'top-right': {
    containerStyle: { top: EDGE, right: EDGE },
    textAlign: 'right',
  },
  'middle-left': {
    containerStyle: { top: MID, left: EDGE, transform: 'translateY(-50%)' },
    textAlign: 'left',
  },
  'middle-center': {
    containerStyle: { top: MID, left: MID, transform: 'translate(-50%, -50%)' },
    textAlign: 'center',
  },
  'middle-right': {
    containerStyle: { top: MID, right: EDGE, transform: 'translateY(-50%)' },
    textAlign: 'right',
  },
  'bottom-left': {
    containerStyle: { bottom: EDGE, left: EDGE },
    textAlign: 'left',
  },
  'bottom-center': {
    containerStyle: { bottom: EDGE, left: MID, transform: 'translateX(-50%)' },
    textAlign: 'center',
  },
  'bottom-right': {
    containerStyle: { bottom: EDGE, right: EDGE },
    textAlign: 'right',
  },
};
