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
 * Positions a text block at one of 9 anchor points; user-controlled font,
 * size, color, and readability treatment (shadow / outline / panel /
 * frosted-glass / none). Panel treatments hug the text with fit-content
 * sizing and auto-derive their background tint from the text luminance.
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
  const resolvedEventText = eventText.trim() || 'Save the Date';
  const resolvedDate = formatDateForDisplay(date);

  const pos = ANCHOR_POSITION[anchor];
  const eventFontSize = EVENT_SIZE[fontSize];
  const dateFontSize = DATE_SIZE[fontSize];
  const decor = treatmentDecorations(treatment, color);

  return (
    <div
      className={['pointer-events-none absolute inset-0', className].filter(Boolean).join(' ')}
      style={{ containerType: 'inline-size' }}
    >
      <div
        className="absolute flex flex-col"
        style={{
          ...pos.containerStyle,
          gap: 'clamp(2px, 1.2cqi, 10px)',
          alignItems: pos.itemsAlign,
          textAlign: pos.textAlign,
          maxWidth: '84%',
        }}
      >
        <div
          style={{
            display: 'inline-block',
            ...decor.panelStyle,
          }}
        >
          <span
            style={{
              display: 'block',
              fontFamily: STD_FONT_CSS_VARS[fontFamily],
              fontSize: eventFontSize,
              color,
              fontWeight: 400,
              lineHeight: 1.15,
              letterSpacing: '0.02em',
              wordBreak: 'break-word',
              ...decor.textStyle,
            }}
          >
            {resolvedEventText}
          </span>
          {resolvedDate && (
            <span
              style={{
                display: 'block',
                marginTop: 'clamp(1px, 0.8cqi, 6px)',
                fontFamily: STD_FONT_CSS_VARS[fontFamily],
                fontSize: dateFontSize,
                color,
                fontWeight: 400,
                lineHeight: 1.2,
                letterSpacing: '0.06em',
                opacity: 0.95,
                ...decor.textStyle,
                ...decor.dateTextStyle,
              }}
            >
              {resolvedDate}
            </span>
          )}
        </div>
      </div>
    </div>
  );
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

interface TreatmentDecorations {
  panelStyle: React.CSSProperties;
  textStyle: React.CSSProperties;
  dateTextStyle?: React.CSSProperties;
}

function treatmentDecorations(
  treatment: STDTextTreatment,
  textColor: string,
): TreatmentDecorations {
  const textIsLight = hexLuminance(textColor) >= 0.6;
  const strokeColor = textIsLight ? 'rgba(0,0,0,0.75)' : 'rgba(255,255,255,0.85)';

  switch (treatment) {
    case 'none':
      return { panelStyle: {}, textStyle: {} };

    case 'shadow':
      return {
        panelStyle: {},
        textStyle: {
          textShadow: '0 2px 10px rgba(0,0,0,0.75), 0 0 3px rgba(0,0,0,0.45)',
        },
      };

    case 'outline':
      return {
        panelStyle: {},
        textStyle: {
          WebkitTextStroke: `clamp(0.5px, 0.25cqi, 1.6px) ${strokeColor}`,
          paintOrder: 'stroke fill',
          textShadow: '0 1px 3px rgba(0,0,0,0.35)',
        } as React.CSSProperties,
      };

    case 'panel':
      return {
        panelStyle: {
          backgroundColor: textIsLight ? 'rgba(20,20,24,0.55)' : 'rgba(250,248,244,0.7)',
          padding: 'clamp(4px, 2cqi, 18px) clamp(8px, 3cqi, 28px)',
          borderRadius: 'clamp(2px, 0.4cqi, 4px)',
        },
        textStyle: {},
      };

    case 'frosted':
      return {
        panelStyle: {
          backgroundColor: textIsLight ? 'rgba(20,20,24,0.32)' : 'rgba(250,248,244,0.45)',
          padding: 'clamp(4px, 2cqi, 18px) clamp(8px, 3cqi, 28px)',
          borderRadius: 'clamp(2px, 0.4cqi, 4px)',
          backdropFilter: 'blur(10px) saturate(1.1)',
          WebkitBackdropFilter: 'blur(10px) saturate(1.1)',
        } as React.CSSProperties,
        textStyle: {},
      };
  }
}

type AnchorStyle = {
  containerStyle: React.CSSProperties;
  itemsAlign: 'flex-start' | 'center' | 'flex-end';
  textAlign: 'left' | 'center' | 'right';
};

const EDGE = '8%';
const MID = '50%';
const TRANSLATE_X_CENTER = 'translateX(-50%)';
const TRANSLATE_Y_CENTER = 'translateY(-50%)';
const TRANSLATE_BOTH = 'translate(-50%, -50%)';

const ANCHOR_POSITION: Record<STDAnchor, AnchorStyle> = {
  'top-left': {
    containerStyle: { top: EDGE, left: EDGE },
    itemsAlign: 'flex-start',
    textAlign: 'left',
  },
  'top-center': {
    containerStyle: { top: EDGE, left: MID, transform: TRANSLATE_X_CENTER },
    itemsAlign: 'center',
    textAlign: 'center',
  },
  'top-right': {
    containerStyle: { top: EDGE, right: EDGE },
    itemsAlign: 'flex-end',
    textAlign: 'right',
  },
  'middle-left': {
    containerStyle: { top: MID, left: EDGE, transform: TRANSLATE_Y_CENTER },
    itemsAlign: 'flex-start',
    textAlign: 'left',
  },
  'middle-center': {
    containerStyle: { top: MID, left: MID, transform: TRANSLATE_BOTH },
    itemsAlign: 'center',
    textAlign: 'center',
  },
  'middle-right': {
    containerStyle: { top: MID, right: EDGE, transform: TRANSLATE_Y_CENTER },
    itemsAlign: 'flex-end',
    textAlign: 'right',
  },
  'bottom-left': {
    containerStyle: { bottom: EDGE, left: EDGE },
    itemsAlign: 'flex-start',
    textAlign: 'left',
  },
  'bottom-center': {
    containerStyle: { bottom: EDGE, left: MID, transform: TRANSLATE_X_CENTER },
    itemsAlign: 'center',
    textAlign: 'center',
  },
  'bottom-right': {
    containerStyle: { bottom: EDGE, right: EDGE },
    itemsAlign: 'flex-end',
    textAlign: 'right',
  },
};
