'use client';

import { useTranslations } from 'next-intl';
import { motion } from 'framer-motion';
import {
  STD_DEFAULTS,
  STD_FONT_CSS_VARS,
  STD_COLOR_PALETTE,
  type CategoryType,
  type STDFontFamily,
  type STDAnchor,
  type STDSize,
  type STDTextTreatment,
  type STDTextIntensity,
} from '@/lib/customization-types';

interface CustomizationEditorProps {
  category: CategoryType;
  values: Record<string, string>;
  onValueChange: (field: string, value: string) => void;
  onComplete: () => void;
}

/** Maps internal field names to i18n keys */
const FIELD_I18N: Record<string, string> = {
  songName: 'fieldSongName',
  artistName: 'fieldArtistName',
  title: 'fieldTitle',
  artist: 'fieldArtist',
  year: 'fieldYear',
  studioText: 'fieldStudioText',
  japaneseText: 'fieldDecorativeText',
  customText: 'fieldCustomText',
  eventText: 'fieldEventText',
  date: 'fieldDate',
};

const containerVariants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.06 } },
};

const itemVariants = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0, transition: { type: 'spring' as const, stiffness: 300, damping: 24 } },
};

export function CustomizationEditor({
  category,
  values,
  onValueChange,
  onComplete,
}: CustomizationEditorProps) {
  const t = useTranslations('builder');

  return (
    <div className="flex flex-col gap-6">
      <div className="text-center">
        <motion.h2
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="font-serif text-2xl font-bold text-charcoal md:text-3xl"
        >
          {t('customizeTitle')}
        </motion.h2>
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.1 }}
          className="mt-2 text-sm text-warm-gray md:text-base"
        >
          {t('customizeHint')}
        </motion.p>
      </div>

      <motion.div
        variants={containerVariants}
        initial="hidden"
        animate="visible"
        className="flex flex-col gap-4"
      >
        {category === 'spotify' && (
          <SpotifyFields values={values} onChange={onValueChange} />
        )}
        {category === 'arte' && (
          <ArteFields values={values} onChange={onValueChange} />
        )}
        {category === 'studio' && (
          <StudioFields values={values} onChange={onValueChange} />
        )}
        {category === 'save-the-date' && (
          <SaveTheDateFields values={values} onChange={onValueChange} />
        )}

        <motion.div variants={itemVariants}>
          <button
            onClick={onComplete}
            className="min-h-[48px] w-full rounded-xl bg-btn-primary px-6 py-3 text-base font-semibold text-btn-text transition-colors hover:bg-btn-primary-hover cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-btn-primary"
          >
            {t('continue')}
          </button>
        </motion.div>
      </motion.div>
    </div>
  );
}

// ─── Field Components ─────────────────────────────────────────────────────────

function FieldInput({
  field,
  value,
  onChange,
  type = 'text',
  hint,
  placeholder: customPlaceholder,
}: {
  field: string;
  value: string;
  onChange: (field: string, value: string) => void;
  type?: 'text' | 'date';
  hint?: string;
  placeholder?: string;
}) {
  const t = useTranslations('builder');
  const label = t(FIELD_I18N[field] || field);

  return (
    <motion.div variants={itemVariants} className="flex flex-col gap-1.5">
      <label htmlFor={`field-${field}`} className="text-sm font-medium text-charcoal">
        {label}
      </label>
      {hint && (
        <span className="text-xs text-warm-gray">{hint}</span>
      )}
      <input
        id={`field-${field}`}
        type={type}
        value={value}
        onChange={(e) => onChange(field, e.target.value)}
        className="min-h-[48px] rounded-lg border-2 border-light-gray bg-white px-4 py-3 text-sm text-charcoal transition-colors focus:border-terracotta focus:outline-none"
        placeholder={customPlaceholder || (type === 'date' ? '' : label)}
      />
    </motion.div>
  );
}

function FieldTextarea({
  field,
  value,
  onChange,
  hint,
  placeholder: customPlaceholder,
  rows = 3,
}: {
  field: string;
  value: string;
  onChange: (field: string, value: string) => void;
  hint?: string;
  placeholder?: string;
  rows?: number;
}) {
  const t = useTranslations('builder');
  const label = t(FIELD_I18N[field] || field);

  return (
    <motion.div variants={itemVariants} className="flex flex-col gap-1.5">
      <label htmlFor={`field-${field}`} className="text-sm font-medium text-charcoal">
        {label}
      </label>
      <textarea
        id={`field-${field}`}
        value={value}
        onChange={(e) => onChange(field, e.target.value)}
        rows={rows}
        className="min-h-[88px] rounded-lg border-2 border-light-gray bg-white px-4 py-3 text-sm text-charcoal transition-colors focus:border-terracotta focus:outline-none resize-y"
        placeholder={customPlaceholder || label}
      />
      {hint && (
        <span className="text-xs text-warm-gray">{hint}</span>
      )}
    </motion.div>
  );
}

function SpotifyFields({
  values,
  onChange,
}: {
  values: Record<string, string>;
  onChange: (field: string, value: string) => void;
}) {
  return (
    <>
      <FieldInput field="songName" value={values.songName || ''} onChange={onChange} />
      <FieldInput field="artistName" value={values.artistName || ''} onChange={onChange} />
    </>
  );
}

function ArteFields({
  values,
  onChange,
}: {
  values: Record<string, string>;
  onChange: (field: string, value: string) => void;
}) {
  return (
    <>
      <FieldInput field="title" value={values.title || ''} onChange={onChange} />
      <FieldInput field="artist" value={values.artist || ''} onChange={onChange} />
      <FieldInput field="year" value={values.year || ''} onChange={onChange} />
    </>
  );
}

function StudioFields({
  values,
  onChange,
}: {
  values: Record<string, string>;
  onChange: (field: string, value: string) => void;
}) {
  const t = useTranslations('builder');

  return (
    <>
      <FieldInput field="year" value={values.year || ''} onChange={onChange}
        placeholder="ej. 2001"
        hint={t('fieldYearHint')} />
      <FieldInput field="studioText" value={values.studioText || ''} onChange={onChange}
        placeholder="STUDIO GHIBLI"
        hint={t('fieldStudioTextHint')} />
      <FieldInput field="japaneseText" value={values.japaneseText || ''} onChange={onChange}
        placeholder="ej. 千と千尋の神隠し"
        hint={t('fieldDecorativeTextHint')} />
      <FieldInput field="customText" value={values.customText || ''} onChange={onChange}
        placeholder="ej. EL VIAJE DE CHIHIRO"
        hint={t('fieldCustomTextHint')} />
    </>
  );
}

const STD_FONT_OPTIONS: ReadonlyArray<{ value: STDFontFamily; label: string }> = [
  { value: 'cormorant', label: 'Cormorant' },
  { value: 'playfair', label: 'Playfair' },
  { value: 'montserrat', label: 'Montserrat' },
  { value: 'dm-sans', label: 'DM Sans' },
  { value: 'dancing-script', label: 'Dancing' },
  { value: 'great-vibes', label: 'Great Vibes' },
  { value: 'cinzel', label: 'Cinzel' },
  { value: 'tenor-sans', label: 'Tenor Sans' },
];

const STD_SIZE_OPTIONS: ReadonlyArray<{ value: STDSize; labelKey: string }> = [
  { value: 'S', labelKey: 'fieldSizeS' },
  { value: 'M', labelKey: 'fieldSizeM' },
  { value: 'L', labelKey: 'fieldSizeL' },
];

const STD_ANCHOR_GRID: ReadonlyArray<STDAnchor> = [
  'top-left', 'top-center', 'top-right',
  'middle-left', 'middle-center', 'middle-right',
  'bottom-left', 'bottom-center', 'bottom-right',
];

const STD_TREATMENT_OPTIONS: ReadonlyArray<{ value: STDTextTreatment; labelKey: string }> = [
  { value: 'none',    labelKey: 'treatmentNone' },
  { value: 'shadow',  labelKey: 'treatmentShadow' },
  { value: 'halo',    labelKey: 'treatmentHalo' },
  { value: 'outline', labelKey: 'treatmentOutline' },
  { value: 'card',    labelKey: 'treatmentCard' },
  { value: 'frame',   labelKey: 'treatmentFrame' },
];

const STD_INTENSITY_OPTIONS: ReadonlyArray<{ value: STDTextIntensity; labelKey: string }> = [
  { value: 'subtle',  labelKey: 'intensitySubtle' },
  { value: 'medium',  labelKey: 'intensityMedium' },
  { value: 'intense', labelKey: 'intensityIntense' },
];

function SaveTheDateFields({
  values,
  onChange,
}: {
  values: Record<string, string>;
  onChange: (field: string, value: string) => void;
}) {
  const t = useTranslations('builder');
  const fontFamily = (values.fontFamily as STDFontFamily) || STD_DEFAULTS.fontFamily;
  const fontSize = (values.fontSize as STDSize) || STD_DEFAULTS.fontSize;
  const color = values.color || STD_DEFAULTS.color;
  const anchor = (values.anchor as STDAnchor) || STD_DEFAULTS.anchor;
  const treatment = (values.treatment as STDTextTreatment) || STD_DEFAULTS.treatment;
  const intensity = (values.intensity as STDTextIntensity) || STD_DEFAULTS.intensity;
  const intensityApplies = treatment === 'shadow' || treatment === 'halo';

  return (
    <>
      <FieldTextarea
        field="eventText"
        value={values.eventText || ''}
        onChange={onChange}
        placeholder="Save the Date"
        hint={t('fieldEventTextHint')}
        rows={3}
      />
      <FieldInput field="date" value={values.date || ''} onChange={onChange} type="date" />

      <motion.div variants={itemVariants} className="flex flex-col gap-2">
        <span className="text-sm font-medium text-charcoal">{t('fieldFontFamily')}</span>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {STD_FONT_OPTIONS.map((opt) => {
            const selected = fontFamily === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => onChange('fontFamily', opt.value)}
                className={[
                  'min-h-[56px] rounded-lg border-2 px-3 py-2 text-center transition-colors cursor-pointer',
                  selected
                    ? 'border-terracotta bg-terracotta/5'
                    : 'border-light-gray bg-white hover:border-warm-gray',
                ].join(' ')}
                style={{ fontFamily: STD_FONT_CSS_VARS[opt.value], fontSize: '18px' }}
                aria-pressed={selected}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </motion.div>

      <motion.div variants={itemVariants} className="flex flex-col gap-2">
        <span className="text-sm font-medium text-charcoal">{t('fieldFontSize')}</span>
        <div className="grid grid-cols-3 gap-2">
          {STD_SIZE_OPTIONS.map((opt) => {
            const selected = fontSize === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => onChange('fontSize', opt.value)}
                className={[
                  'min-h-[48px] rounded-lg border-2 px-3 py-2 text-sm font-medium transition-colors cursor-pointer',
                  selected
                    ? 'border-terracotta bg-terracotta text-white'
                    : 'border-light-gray bg-white text-charcoal hover:border-warm-gray',
                ].join(' ')}
                aria-pressed={selected}
              >
                {t(opt.labelKey)}
              </button>
            );
          })}
        </div>
      </motion.div>

      <motion.div variants={itemVariants} className="flex flex-col gap-2">
        <span className="text-sm font-medium text-charcoal">{t('fieldTextColor')}</span>
        <div className="flex flex-wrap items-center gap-2">
          {STD_COLOR_PALETTE.map((swatch) => {
            const selected = color.toLowerCase() === swatch.hex.toLowerCase();
            return (
              <button
                key={swatch.hex}
                type="button"
                onClick={() => onChange('color', swatch.hex)}
                className={[
                  'h-9 w-9 rounded-full border-2 transition-transform cursor-pointer',
                  selected ? 'scale-110 border-terracotta ring-2 ring-terracotta/30' : 'border-light-gray',
                ].join(' ')}
                style={{ backgroundColor: swatch.hex }}
                aria-label={swatch.nameKey}
                aria-pressed={selected}
              />
            );
          })}
          <label className="inline-flex items-center gap-1.5 rounded-lg border-2 border-light-gray px-3 py-1.5 text-xs font-medium text-charcoal hover:border-warm-gray cursor-pointer">
            <span
              className="inline-block h-5 w-5 rounded-full border border-light-gray"
              style={{ backgroundColor: color }}
              aria-hidden="true"
            />
            {t('fieldColorCustom')}
            <input
              type="color"
              value={color.startsWith('#') ? color : '#FFFFFF'}
              onChange={(e) => onChange('color', e.target.value.toUpperCase())}
              className="sr-only"
            />
          </label>
        </div>
      </motion.div>

      <motion.div variants={itemVariants} className="flex flex-col gap-2">
        <span className="text-sm font-medium text-charcoal">{t('fieldReadability')}</span>
        <div className="flex flex-wrap gap-2">
          {STD_TREATMENT_OPTIONS.map((opt) => {
            const selected = treatment === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => onChange('treatment', opt.value)}
                className={[
                  'min-h-[40px] rounded-lg border-2 px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer',
                  selected
                    ? 'border-terracotta bg-terracotta text-white'
                    : 'border-light-gray bg-white text-charcoal hover:border-warm-gray',
                ].join(' ')}
                aria-pressed={selected}
              >
                {t(opt.labelKey)}
              </button>
            );
          })}
        </div>
      </motion.div>

      {intensityApplies && (
        <motion.div variants={itemVariants} className="flex flex-col gap-2">
          <span className="text-sm font-medium text-charcoal">{t('fieldIntensity')}</span>
          <div className="grid grid-cols-3 gap-2">
            {STD_INTENSITY_OPTIONS.map((opt) => {
              const selected = intensity === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => onChange('intensity', opt.value)}
                  className={[
                    'min-h-[44px] rounded-lg border-2 px-3 py-2 text-sm font-medium transition-colors cursor-pointer',
                    selected
                      ? 'border-terracotta bg-terracotta text-white'
                      : 'border-light-gray bg-white text-charcoal hover:border-warm-gray',
                  ].join(' ')}
                  aria-pressed={selected}
                >
                  {t(opt.labelKey)}
                </button>
              );
            })}
          </div>
        </motion.div>
      )}

      <motion.div variants={itemVariants} className="flex flex-col gap-2">
        <span className="text-sm font-medium text-charcoal">{t('fieldTextPosition')}</span>
        <div className="grid w-full max-w-[220px] grid-cols-3 grid-rows-3 gap-1.5 rounded-lg bg-light-gray/50 p-1.5">
          {STD_ANCHOR_GRID.map((a) => {
            const selected = anchor === a;
            return (
              <button
                key={a}
                type="button"
                onClick={() => onChange('anchor', a)}
                className={[
                  'aspect-square w-full rounded-md border-2 transition-colors cursor-pointer',
                  selected
                    ? 'border-terracotta bg-terracotta'
                    : 'border-light-gray bg-white hover:border-warm-gray',
                ].join(' ')}
                aria-label={a}
                aria-pressed={selected}
              />
            );
          })}
        </div>
      </motion.div>
    </>
  );
}
