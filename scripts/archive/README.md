# Archived scripts

These scripts ran against the pre-Shopify-Files architecture (Cloudflare R2
+ Shopify Admin API `2024-10`). Phase 2 of the Shopify-centric migration
replaced R2 with Shopify Files; Phase 0 bumped the Admin API surface to
`2026-04`. The scripts still reference old hostnames and API versions.

Per UAT-3 Phase 4 (Codex audit C6/C7): archived rather than re-bumped,
because bumping the API version on a script that still encodes R2-era
storage semantics would silently re-execute against the wrong substrate.

If you need analogous cleanup for the current Shopify Files setup, copy
the structure but rebuild the storage interactions against
`src/lib/storage.ts` (which already targets Shopify Files and the
canonical API version constant).

- `cleanup-stale-metafields.mts` — used to remove stale `print_files`
  metafields keyed by R2 URLs.
- `cleanup-orphan-r2-tiles.mts` — used to delete orphaned print tiles
  from Cloudflare R2 buckets that no longer exist in this project.
