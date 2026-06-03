import { NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import { verifySession } from '@/lib/admin/auth';
import { SITE_COPY_TAG, SITE_COPY_BUSINESS_TAG } from '@/lib/site-content';
import {
  getBusinessSettingsMetaobject,
  getHomeCopyTranslations,
  getTranslatableContentDigests,
} from '@/lib/shopify/queries/metaobjects';
import {
  updateMetaobjectFields,
  registerTranslations,
  removeTranslations,
  ShopifyUserErrorsError,
} from '@/lib/shopify/mutations/metaobjects';
import {
  validateBusinessSettings,
  BusinessSettingsValidationError,
  type AdminBusinessSettings,
} from '@/lib/admin/business-settings-validation';

// Metaobject field keys (mosaiko_business_settings).
const FIELD = {
  businessName: 'business_name', // localized
  footerCopy: 'footer_copy', // localized
  address: 'address',
  phone: 'phone',
  whatsapp: 'whatsapp',
  instagramUrl: 'instagram_url',
  facebookUrl: 'facebook_url',
  notificationEmail: 'notification_email',
} as const;

// Fields that carry EN translations.
const LOCALIZED_FIELD_KEYS = [FIELD.businessName, FIELD.footerCopy] as const;

function unauthorized(): NextResponse {
  return NextResponse.json(
    { error: { code: 'UNAUTHORIZED', message: 'No autorizado.' } },
    { status: 401 },
  );
}

function notSeeded(): NextResponse {
  return NextResponse.json(
    {
      error: {
        code: 'BUSINESS_SETTINGS_NOT_FOUND',
        message:
          'El metaobjeto mosaiko_business_settings aún no existe en Shopify. Ejecuta `npm run shopify:seed-metaobjects`.',
      },
    },
    { status: 500 },
  );
}

function emptySettings(): AdminBusinessSettings {
  return {
    businessName: { es: '', en: '' },
    footerCopy: { es: '', en: '' },
    address: '',
    phone: '',
    whatsapp: '',
    instagramUrl: '',
    facebookUrl: '',
    notificationEmail: '',
  };
}

// ─── GET: hydrate admin form ────────────────────────────────────────────────

export async function GET(): Promise<NextResponse> {
  if (!(await verifySession())) return unauthorized();

  try {
    const metaobject = await getBusinessSettingsMetaobject();
    if (!metaobject) return notSeeded();

    const base = new Map<string, string>();
    for (const f of metaobject.fields) {
      if (typeof f.value === 'string') base.set(f.key, f.value);
    }

    const settings = emptySettings();
    settings.businessName.es = base.get(FIELD.businessName) ?? '';
    settings.footerCopy.es = base.get(FIELD.footerCopy) ?? '';
    settings.address = base.get(FIELD.address) ?? '';
    settings.phone = base.get(FIELD.phone) ?? '';
    settings.whatsapp = base.get(FIELD.whatsapp) ?? '';
    settings.instagramUrl = base.get(FIELD.instagramUrl) ?? '';
    settings.facebookUrl = base.get(FIELD.facebookUrl) ?? '';
    settings.notificationEmail = base.get(FIELD.notificationEmail) ?? '';

    // EN translations (best-effort — scope may be missing or none registered).
    try {
      const enTranslations = await getHomeCopyTranslations(metaobject.id, 'en');
      const en = new Map<string, string>();
      for (const t of enTranslations) {
        if (typeof t.value === 'string') en.set(t.key, t.value);
      }
      settings.businessName.en = en.get(FIELD.businessName) ?? '';
      settings.footerCopy.en = en.get(FIELD.footerCopy) ?? '';
    } catch (error) {
      console.warn('[admin/negocio GET] EN translations fetch failed:', error);
    }

    return NextResponse.json({ settings });
  } catch (error) {
    console.error('[admin/negocio GET] failed:', error);
    return NextResponse.json(
      { error: { code: 'SHOPIFY_READ_FAILED', message: 'No se pudo cargar la información de negocio.' } },
      { status: 502 },
    );
  }
}

// ─── PUT: save ──────────────────────────────────────────────────────────────

export async function PUT(request: Request): Promise<NextResponse> {
  if (!(await verifySession())) return unauthorized();

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json(
      { error: { code: 'VALIDATION_ERROR', message: 'Cuerpo JSON inválido.' } },
      { status: 400 },
    );
  }

  let s: AdminBusinessSettings;
  try {
    s = validateBusinessSettings(rawBody);
  } catch (error) {
    if (error instanceof BusinessSettingsValidationError) {
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', issues: error.issues } },
        { status: 400 },
      );
    }
    throw error;
  }

  // Resolve metaobject id.
  let metaobject;
  try {
    metaobject = await getBusinessSettingsMetaobject();
  } catch (error) {
    console.error('[admin/negocio PUT] getMetaobject failed:', error);
    return NextResponse.json(
      { error: { code: 'SHOPIFY_WRITE_FAILED', message: 'No se pudo conectar con Shopify.' } },
      { status: 502 },
    );
  }
  if (!metaobject) return notSeeded();
  const resourceId = metaobject.id;

  // 1. Base (ES + neutral) fields.
  const baseFields = [
    { key: FIELD.businessName, value: s.businessName.es },
    { key: FIELD.footerCopy, value: s.footerCopy.es },
    { key: FIELD.address, value: s.address },
    { key: FIELD.phone, value: s.phone },
    { key: FIELD.whatsapp, value: s.whatsapp },
    { key: FIELD.instagramUrl, value: s.instagramUrl },
    { key: FIELD.facebookUrl, value: s.facebookUrl },
    { key: FIELD.notificationEmail, value: s.notificationEmail },
  ];
  try {
    await updateMetaobjectFields(resourceId, baseFields);
  } catch (error) {
    if (error instanceof ShopifyUserErrorsError) {
      return NextResponse.json(
        { error: { code: 'SHOPIFY_WRITE_FAILED', message: 'Shopify rechazó la actualización.', details: error.userErrors } },
        { status: 502 },
      );
    }
    console.error('[admin/negocio PUT] metaobjectUpdate failed:', error);
    return NextResponse.json(
      { error: { code: 'SHOPIFY_WRITE_FAILED', message: 'No se pudo guardar la información de negocio.' } },
      { status: 502 },
    );
  }

  // 2. EN translations for localized fields. Empty → remove; non-empty → register.
  const enValues: Record<string, string> = {
    [FIELD.businessName]: s.businessName.en,
    [FIELD.footerCopy]: s.footerCopy.en,
  };
  const toRemove: string[] = [];
  const toRegister: Array<{ fieldKey: string; value: string }> = [];
  for (const key of LOCALIZED_FIELD_KEYS) {
    const v = enValues[key];
    if (v === '') toRemove.push(key);
    else toRegister.push({ fieldKey: key, value: v });
  }

  if (toRemove.length > 0) {
    try {
      await removeTranslations(resourceId, 'en', toRemove);
    } catch (error) {
      if (error instanceof ShopifyUserErrorsError) {
        return NextResponse.json(
          { error: { code: 'SHOPIFY_WRITE_FAILED', message: 'Shopify rechazó la eliminación de traducciones.', details: error.userErrors } },
          { status: 502 },
        );
      }
      console.error('[admin/negocio PUT] translationsRemove failed:', error);
      return NextResponse.json(
        { error: { code: 'SHOPIFY_WRITE_FAILED', message: 'No se pudieron eliminar las traducciones.' } },
        { status: 502 },
      );
    }
  }

  if (toRegister.length > 0) {
    let digests: Record<string, string>;
    try {
      digests = await getTranslatableContentDigests(resourceId);
    } catch (error) {
      console.error('[admin/negocio PUT] digest fetch failed:', error);
      return NextResponse.json(
        { error: { code: 'SHOPIFY_WRITE_FAILED', message: 'No se pudieron obtener los digests de traducción.' } },
        { status: 502 },
      );
    }
    const translations: Array<{ key: string; value: string; translatableContentDigest: string }> = [];
    const missing: string[] = [];
    for (const { fieldKey, value } of toRegister) {
      const digest = digests[fieldKey];
      if (!digest) {
        missing.push(fieldKey);
        continue;
      }
      translations.push({ key: fieldKey, value, translatableContentDigest: digest });
    }
    if (missing.length > 0) {
      return NextResponse.json(
        { error: { code: 'SHOPIFY_WRITE_FAILED', message: 'Shopify no devolvió digests para algunos campos.', details: missing } },
        { status: 502 },
      );
    }
    try {
      await registerTranslations(resourceId, 'en', translations);
    } catch (error) {
      if (error instanceof ShopifyUserErrorsError) {
        return NextResponse.json(
          { error: { code: 'SHOPIFY_WRITE_FAILED', message: 'Shopify rechazó las traducciones.', details: error.userErrors } },
          { status: 502 },
        );
      }
      console.error('[admin/negocio PUT] translationsRegister failed:', error);
      return NextResponse.json(
        { error: { code: 'SHOPIFY_WRITE_FAILED', message: 'No se pudieron guardar las traducciones.' } },
        { status: 502 },
      );
    }
  }

  revalidateTag(SITE_COPY_TAG, { expire: 0 });
  revalidateTag(SITE_COPY_BUSINESS_TAG, { expire: 0 });

  return NextResponse.json({ ok: true, settings: s });
}
