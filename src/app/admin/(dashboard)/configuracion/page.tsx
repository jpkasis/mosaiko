import { ConfiguracionContent } from '@/components/admin/ConfiguracionContent';
import { HOME_COPY_MAP } from '@/lib/site-content';
import esMessages from '@/messages/es.json';
import enMessages from '@/messages/en.json';

type CopyPath = keyof typeof HOME_COPY_MAP;
type Fallbacks = Partial<Record<CopyPath, string>>;

function readNested(messages: Record<string, unknown>, path: string): string | undefined {
  const segments = path.split('.');
  let cursor: unknown = messages;
  for (const seg of segments) {
    if (typeof cursor !== 'object' || cursor === null) return undefined;
    cursor = (cursor as Record<string, unknown>)[seg];
  }
  return typeof cursor === 'string' ? cursor : undefined;
}

function extractFallbacks(messages: Record<string, unknown>): Fallbacks {
  const out: Fallbacks = {};
  for (const path of Object.keys(HOME_COPY_MAP) as CopyPath[]) {
    const v = readNested(messages, path);
    if (v !== undefined) out[path] = v;
  }
  return out;
}

export default function ConfiguracionPage() {
  // Static next-intl JSON values become the placeholders in the admin form.
  // Shows the admin what will render on the storefront if they leave a
  // Shopify field blank.
  const esFallbacks = extractFallbacks(esMessages as unknown as Record<string, unknown>);
  const enFallbacks = extractFallbacks(enMessages as unknown as Record<string, unknown>);
  return <ConfiguracionContent fallbacks={{ es: esFallbacks, en: enFallbacks }} />;
}
