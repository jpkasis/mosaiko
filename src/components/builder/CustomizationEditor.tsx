'use client';

import { useTranslations } from 'next-intl';
import { motion } from 'framer-motion';
import type { CategoryType } from '@/lib/customization-types';

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
        {category === 'ghibli' && (
          <GhibliFields values={values} onChange={onValueChange} />
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

function GhibliFields({
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

function SaveTheDateFields({
  values,
  onChange,
}: {
  values: Record<string, string>;
  onChange: (field: string, value: string) => void;
}) {
  return (
    <>
      <FieldInput field="eventText" value={values.eventText || ''} onChange={onChange} />
      <FieldInput field="date" value={values.date || ''} onChange={onChange} type="date" />
    </>
  );
}
