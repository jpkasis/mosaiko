import type { TonosIntensity, TonosToneColumn } from '../../customization-types';
import type { SharpFilterConfig, CSSFilterPreset } from '../types';

// ─── Tone bases ─────────────────────────────────────────────────────────────
// Tunable visual constants. Intensity scales these values linearly (see below).

interface ToneBase {
  hueRotation: number;
  saturation: number;
  brightness: number;
  tint: { r: number; g: number; b: number };
}

const WARM_BASE: ToneBase = {
  hueRotation: 15,
  saturation: 1.3,
  brightness: 1.05,
  tint: { r: 240, g: 200, b: 150 },
};

const COOL_BASE: ToneBase = {
  hueRotation: -20,
  saturation: 1.1,
  brightness: 1.0,
  tint: { r: 150, g: 180, b: 240 },
};

// Intensity multiplier. 0 = no effect, 1 = base, >1 = stronger.
const INTENSITY_SCALAR: Record<TonosIntensity, number> = {
  mild: 0.5,
  medium: 1.0,
  strong: 1.5,
};

// How much the base numeric tones modulate around their neutral (1.0 for sat/brightness, 0 for hue).
// Intensity 1.0 = base values applied. 0.5 = half-way toward base from neutral. 1.5 = 50% past base.
function scaleTone(base: ToneBase, intensity: TonosIntensity): ToneBase {
  const k = INTENSITY_SCALAR[intensity];
  return {
    hueRotation: base.hueRotation * k,
    saturation: 1 + (base.saturation - 1) * k,
    brightness: 1 + (base.brightness - 1) * k,
    tint: base.tint,
  };
}

// ─── Sharp filter (server-side print) ───────────────────────────────────────

/**
 * Returns a SharpFilterConfig for a single Tonos tile given its column and
 * the user-selected intensity. The middle column ("none") returns an original
 * passthrough config. Tint strength scales with intensity.
 */
export function getTonosColumnFilter(
  column: TonosToneColumn,
  intensity: TonosIntensity,
  tileIndex: number,
): SharpFilterConfig {
  if (column === 'none') {
    return { tileIndex, isOriginal: true };
  }

  const base = column === 'warm' ? WARM_BASE : COOL_BASE;
  const scaled = scaleTone(base, intensity);

  return {
    tileIndex,
    hueRotation: scaled.hueRotation,
    saturation: scaled.saturation,
    brightness: scaled.brightness,
    tint: scaled.tint,
    isOriginal: false,
  };
}

// ─── CSS filter (client-side preview) ───────────────────────────────────────

/**
 * Returns a CSS filter string for a single Tonos tile. Uses approximate CSS
 * equivalents of the Sharp operations: hue-rotate + saturate + brightness +
 * sepia (warm) / subtle cool wash via hue-rotate (cool).
 */
export function getTonosColumnCSSFilter(
  column: TonosToneColumn,
  intensity: TonosIntensity,
): string {
  if (column === 'none') return 'none';

  const base = column === 'warm' ? WARM_BASE : COOL_BASE;
  const scaled = scaleTone(base, intensity);
  const k = INTENSITY_SCALAR[intensity];

  if (column === 'warm') {
    // sepia adds the warm paper undertone; the rest shapes color temperature
    const sepia = Math.min(0.5, 0.3 * k);
    return `sepia(${sepia.toFixed(2)}) saturate(${scaled.saturation.toFixed(2)}) brightness(${scaled.brightness.toFixed(2)}) hue-rotate(${Math.round(scaled.hueRotation)}deg)`;
  }

  // cool
  return `saturate(${scaled.saturation.toFixed(2)}) brightness(${scaled.brightness.toFixed(2)}) hue-rotate(${Math.round(scaled.hueRotation)}deg)`;
}
