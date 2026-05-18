/**
 * Single source of truth for where data assets live.
 *
 * Production: `VITE_DATA_BASE_URL=https://budget-assets.bettergov.ph` at build time.
 * Dev: serve from local Vite static tree at `/data`.
 *
 * Used by:
 *   - dept-data.ts (Stage A JSONs)
 *   - duckdb.ts (parquet URLs + manifests)
 *   - National.tsx (national/index.json)
 */

const ENV_OVERRIDE = (
  import.meta.env.VITE_DATA_BASE_URL as string | undefined
)?.trim();

/** Resolve `dataUrl('07/agencies.json')` to a fully-qualified URL. */
export function dataUrl(path: string): string {
  const rel = path.replace(/^\/+/, "");
  if (ENV_OVERRIDE) {
    return `${ENV_OVERRIDE.replace(/\/$/, "")}/${rel}`;
  }
  const base = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");
  return `${base}/data/${rel}`;
}

/** Per-dept directory URL: `dataDeptUrl('07') → '<base>/07'`. */
export function dataDeptUrl(deptId: string): string {
  if (ENV_OVERRIDE) return `${ENV_OVERRIDE.replace(/\/$/, "")}/${deptId}`;
  const base = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");
  return `${base}/data/${deptId}`;
}
