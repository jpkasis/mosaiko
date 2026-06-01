/**
 * Pure-function recursive deep-merge of two JSON-shaped objects.
 *
 * Semantics:
 *   - Both inputs are treated as immutable; neither is mutated.
 *   - Nested plain objects merge recursively (override wins on conflict).
 *   - Arrays and primitives REPLACE (no concat, no element-merge). The
 *     translation override layer never needs to splice into arrays, and
 *     keeping replace-semantics avoids hard-to-reason-about merges.
 *   - `null` in the override is treated as "explicit absence" — the base
 *     value wins. Use `''` if you genuinely want to blank a string out
 *     (though the site-copy contract treats `''` as "missing" upstream).
 *
 * Used by `src/i18n/request.ts` to merge Shopify Metaobject overrides
 * over static next-intl JSON dictionaries.
 */

type JsonRecord = Record<string, unknown>;

function isPlainObject(value: unknown): value is JsonRecord {
  if (value === null || typeof value !== 'object') return false;
  if (Array.isArray(value)) return false;
  // Cross-realm-safe plain-object check.
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

export function deepMerge<T extends JsonRecord>(base: T, override: JsonRecord): T {
  const out: JsonRecord = { ...base };
  for (const key of Object.keys(override)) {
    const overrideValue = override[key];
    if (overrideValue === null) continue; // explicit absence — keep base
    const baseValue = out[key];
    if (isPlainObject(baseValue) && isPlainObject(overrideValue)) {
      out[key] = deepMerge(baseValue, overrideValue);
    } else {
      // Arrays and primitives: override replaces.
      out[key] = overrideValue;
    }
  }
  return out as T;
}
