import { NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import { verifySession } from '@/lib/admin/auth';
import {
  HOME_COPY_MAP,
  SITE_COPY_TAG,
  SITE_COPY_HOME_TAG,
} from '@/lib/site-content';
import {
  getHomeCopyMetaobject,
  getHomeCopyTranslations,
  getTranslatableContentDigests,
} from '@/lib/shopify/queries/metaobjects';
import {
  updateMetaobjectFields,
  registerTranslations,
  ShopifyUserErrorsError,
} from '@/lib/shopify/mutations/metaobjects';
import {
  validateContenidoBody,
  ContenidoValidationError,
  type ContenidoBody,
  type CopyPath,
} from '@/lib/admin/site-copy-validation';

// ─── Helpers ────────────────────────────────────────────────────────────────

type FieldKey = (typeof HOME_COPY_MAP)[keyof typeof HOME_COPY_MAP];

function pathToFieldKey(path: CopyPath): FieldKey {
  return HOME_COPY_MAP[path];
}

function fieldKeyToPath(fieldKey: string): CopyPath | undefined {
  for (const [path, key] of Object.entries(HOME_COPY_MAP)) {
    if (key === fieldKey) return path as CopyPath;
  }
  return undefined;
}

function unauthorized(): NextResponse {
  return NextResponse.json({ error: 'No autorizado.' }, { status: 401 });
}

// ─── GET: hydrate admin form ────────────────────────────────────────────────
//
// Returns `{ es, en }` shaped by next-intl path, sourced from the live
// Shopify metaobject + EN translations. Empty fields are returned as
// empty strings (the admin form treats empty as "use static fallback"
// and shows the next-intl default as placeholder).

interface ContenidoGetResponse {
  content: ContenidoBody;
  translationStatus?: {
    en: {
      available: boolean;
      message?: string;
    };
  };
}

function isTranslationScopeError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes('read_translations') ||
    message.includes('write_translations') ||
    (message.includes('Access denied') && message.includes('translatableResource'))
  );
}

const TRANSLATION_SCOPE_MESSAGE =
  'La edición en inglés requiere los scopes read_translations y write_translations en Shopify. Agrégalos y reinstala la app.';

export async function GET(): Promise<NextResponse> {
  if (!(await verifySession())) return unauthorized();

  try {
    const metaobject = await getHomeCopyMetaobject();
    if (!metaobject) {
      return NextResponse.json(
        {
          error:
            'El metaobjeto mosaiko_home_copy aún no existe en Shopify. Ejecuta `npm run shopify:seed-metaobjects` antes de editar contenido.',
        },
        { status: 404 },
      );
    }

    const es: ContenidoBody['es'] = {};
    for (const f of metaobject.fields) {
      const path = fieldKeyToPath(f.key);
      if (!path) continue;
      es[path] = f.value ?? '';
    }

    const en: ContenidoBody['en'] = {};
    let enAvailable = true;
    let enMessage: string | undefined;
    try {
      const enTranslations = await getHomeCopyTranslations(metaobject.id, 'en');
      for (const t of enTranslations) {
        const path = fieldKeyToPath(t.key);
        if (!path) continue;
        en[path] = t.value ?? '';
      }
    } catch (error) {
      enAvailable = false;
      enMessage = isTranslationScopeError(error)
        ? TRANSLATION_SCOPE_MESSAGE
        : 'No se pudieron cargar las traducciones en inglés.';
      // EN translation lookup is best-effort on GET. Surface availability
      // to the client so it can keep ES editing usable without inviting an
      // EN save that will fail at digest/translation registration.
      console.warn('[admin/contenido GET] EN translations fetch failed:', error);
    }

    const body: ContenidoGetResponse = {
      content: { es, en },
      translationStatus: {
        en: { available: enAvailable, message: enMessage },
      },
    };
    return NextResponse.json(body);
  } catch (error) {
    console.error('[admin/contenido GET] failed:', error);
    return NextResponse.json(
      { error: 'No se pudo cargar el contenido.' },
      { status: 502 },
    );
  }
}

// ─── PUT: save (validate → update ES → fetch digests → register EN → revalidate) ──

export async function PUT(request: Request): Promise<NextResponse> {
  if (!(await verifySession())) return unauthorized();

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'Cuerpo JSON inválido.' },
      { status: 400 },
    );
  }

  let validated: ContenidoBody;
  try {
    validated = validateContenidoBody(rawBody);
  } catch (error) {
    if (error instanceof ContenidoValidationError) {
      return NextResponse.json(
        { error: 'Validación falló.', details: error.issues },
        { status: 400 },
      );
    }
    throw error;
  }

  // 1. Resolve metaobject id
  let metaobject;
  try {
    metaobject = await getHomeCopyMetaobject();
  } catch (error) {
    console.error('[admin/contenido PUT] getHomeCopyMetaobject failed:', error);
    return NextResponse.json(
      { error: 'No se pudo conectar con Shopify.' },
      { status: 502 },
    );
  }
  if (!metaobject) {
    return NextResponse.json(
      {
        error:
          'El metaobjeto mosaiko_home_copy aún no existe en Shopify. Ejecuta `npm run shopify:seed-metaobjects` antes de editar contenido.',
      },
      { status: 404 },
    );
  }
  const resourceId = metaobject.id;

  // 2. Update ES (base) fields
  const esFields: Array<{ key: string; value: string }> = [];
  for (const [path, value] of Object.entries(validated.es)) {
    esFields.push({ key: pathToFieldKey(path as CopyPath), value });
  }
  if (esFields.length > 0) {
    try {
      await updateMetaobjectFields(resourceId, esFields);
    } catch (error) {
      if (error instanceof ShopifyUserErrorsError) {
        return NextResponse.json(
          { error: 'Shopify rechazó la actualización.', details: error.userErrors },
          { status: 502 },
        );
      }
      console.error('[admin/contenido PUT] metaobjectUpdate failed:', error);
      return NextResponse.json(
        { error: 'No se pudo guardar el contenido base.' },
        { status: 502 },
      );
    }
  }

  // 3. Fetch fresh digests (MUST be after step 2; base changes invalidate
  //    previous digests). Skip if no EN values to register.
  const enFieldEntries = Object.entries(validated.en);
  if (enFieldEntries.length > 0) {
    let digests: Record<string, string>;
    try {
      digests = await getTranslatableContentDigests(resourceId);
    } catch (error) {
      console.error('[admin/contenido PUT] digest fetch failed:', error);
      return NextResponse.json(
        {
          error: isTranslationScopeError(error)
            ? TRANSLATION_SCOPE_MESSAGE
            : 'No se pudieron obtener los digests de traducción.',
        },
        { status: 502 },
      );
    }

    // 4. Build translation inputs (fail fast if any digest is missing)
    const translations: Array<{ key: string; value: string; translatableContentDigest: string }> = [];
    const missingDigests: string[] = [];
    for (const [path, value] of enFieldEntries) {
      const fieldKey = pathToFieldKey(path as CopyPath);
      const digest = digests[fieldKey];
      if (!digest) {
        missingDigests.push(fieldKey);
        continue;
      }
      translations.push({ key: fieldKey, value, translatableContentDigest: digest });
    }
    if (missingDigests.length > 0) {
      return NextResponse.json(
        {
          error: 'Shopify no devolvió digests para algunos campos.',
          details: missingDigests,
        },
        { status: 502 },
      );
    }

    // 5. Register translations
    try {
      await registerTranslations(resourceId, 'en', translations);
    } catch (error) {
      if (error instanceof ShopifyUserErrorsError) {
        return NextResponse.json(
          { error: 'Shopify rechazó las traducciones.', details: error.userErrors },
          { status: 502 },
        );
      }
      console.error('[admin/contenido PUT] translationsRegister failed:', error);
      return NextResponse.json(
        {
          error: isTranslationScopeError(error)
            ? TRANSLATION_SCOPE_MESSAGE
            : 'No se pudieron guardar las traducciones.',
        },
        { status: 502 },
      );
    }
  }

  // 6. Bust cache tags so the storefront sees the new copy immediately.
  // Next 16 route handlers can use { expire: 0 } for immediate expiry on
  // the next visit; 'max' would serve stale content while revalidating.
  revalidateTag(SITE_COPY_TAG, { expire: 0 });
  revalidateTag(SITE_COPY_HOME_TAG, { expire: 0 });

  // 7. Return the normalized payload echo so the form can replace its state
  const responseBody: ContenidoGetResponse = { content: validated };
  return NextResponse.json(responseBody);
}
