/**
 * Print pipeline output version. Bumped whenever processor pixel
 * semantics change so the webhook can invalidate stale cart composites
 * built against an older renderer.
 *
 * The version travels with each cart line as `_composite_pipeline_version`
 * (set in `src/lib/shopify/checkout.ts`). At webhook time, if the cart
 * composite's version doesn't match `PIPELINE_VERSION`, we ignore the
 * stored composite and re-render from the original photo via
 * `processPrintJob` — guarantees the printed magnet always reflects the
 * current pipeline output (e.g. font fidelity changes in Phase 4).
 *
 * Bump this string (date-suffix optional, just must change) whenever:
 * - A processor's font/color/effect changes the rendered pixels.
 * - `assemble-tiles.ts` composite-layout math changes.
 * - Anything else that would make a stored composite render differently
 *   than a fresh `processPrintJob` would right now.
 */
export const PIPELINE_VERSION = '2026.04.27-phase4-std';
