import { NextResponse } from 'next/server';
import { revalidatePath, revalidateTag } from 'next/cache';
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
  removeTranslations,
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

// ─── PUT: save ──────────────────────────────────────────────────────────────
//
// Sequence:
//   1. verifySession + validateContenidoBody
//   2. getHomeCopyMetaobject (resolve id) — 404 if metaobject not seeded
//   3. updateMetaobjectFields (ES base) — if validated.es non-empty
//   4. Partition validated.en into:
//        - toRemove: keys whose value is '' (intentional clear)
//        - toRegister: keys whose value is non-empty
//   5. removeTranslations(toRemove) — only if non-empty. Done BEFORE register
//      so stale translations against newly-emptied base values are cleared
//      before we try to register anything (Shopify won't return a digest for
//      an empty base, so a register attempt would 502).
//   6. getTranslatableContentDigests — only if toRegister non-empty (must run
//      AFTER step 3 because base changes invalidate previous digests).
//   7. registerTranslations(toRegister) with the fresh digests.
//   8. revalidateTag × 2 ('site-copy', 'site-copy:home') for immediate
//      storefront refresh.

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

  // 3. Partition EN entries: empty strings → translationsRemove,
  //    non-empty strings → translationsRegister. Shopify stops returning
  //    a digest for a field whose base value is empty, so a register call
  //    on a just-cleared field would 502 with "missing digest" — clear
  //    those via translationsRemove instead.
  const toRemove: string[] = [];
  const toRegister: Array<{ fieldKey: string; value: string }> = [];
  for (const [path, value] of Object.entries(validated.en)) {
    const fieldKey = pathToFieldKey(path as CopyPath);
    if (value === '') toRemove.push(fieldKey);
    else toRegister.push({ fieldKey, value });
  }

  // 4. Remove first (clears stale EN translations whose base is now empty).
  //    No-op when toRemove is empty (mutation helper short-circuits).
  if (toRemove.length > 0) {
    try {
      await removeTranslations(resourceId, 'en', toRemove);
    } catch (error) {
      if (error instanceof ShopifyUserErrorsError) {
        return NextResponse.json(
          { error: 'Shopify rechazó la eliminación de traducciones.', details: error.userErrors },
          { status: 502 },
        );
      }
      console.error('[admin/contenido PUT] translationsRemove failed:', error);
      return NextResponse.json(
        {
          error: isTranslationScopeError(error)
            ? TRANSLATION_SCOPE_MESSAGE
            : 'No se pudieron eliminar las traducciones.',
        },
        { status: 502 },
      );
    }
  }

  // 5. Fetch fresh digests (MUST be after step 2; base changes invalidate
  //    previous digests). ONLY needed for non-empty EN values that we're
  //    about to register — clears already happened in step 4.
  if (toRegister.length > 0) {
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

    // 6. Build translation inputs (fail fast if any digest is missing for
    //    a non-empty value — empty values were handled in step 4 and are
    //    not in toRegister).
    const translations: Array<{ key: string; value: string; translatableContentDigest: string }> = [];
    const missingDigests: string[] = [];
    for (const { fieldKey, value } of toRegister) {
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

    // 7. Register non-empty translations
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
  // The storefront [locale] layout/pages are STATICALLY rendered (next-intl
  // setRequestLocale) and read this copy SERVER-side via getMessages — so
  // revalidateTag (data cache) isn't enough; regenerate the route output so the
  // edited copy actually shows in the store (Codex audit: same class as prices).
  revalidatePath('/[locale]', 'layout');

  // 7. Return the normalized payload echo so the form can replace its state
  const responseBody: ContenidoGetResponse = { content: validated };
  return NextResponse.json(responseBody);
}
