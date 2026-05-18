# DuckDB-WASM exploration — findings

Branch: `duckdb-exploration`

## Why we explored this

`PLAN.md` proposes a per-department lazy load that fetches roughly
`departments.json + agencies.json + yearly_totals.json + fpaps.json +
operating_units.json + fund_subcategories.json + expenses.json + objects.json`
on entry to `/d/:deptId`. For most departments that's fine, but the data is
not normally distributed:

| Dept | Total JSON | `objects.json` |
|------|-----------:|---------------:|
| 07 DepEd | **786 MB** | **650 MB** |
| 18 DPWH | 877 MB | 224 MB |
| 10 DBM  | 91 MB | 77 MB |
| 05 DOF  | 110 MB | 56 MB |

A 650 MB single-file `fetch()` is not viable — it pegs the tab, the parser,
and the GC. The existing three-stage progressive load
(`loadDeptData → loadDeptMidInto → loadDeptObjectsInto` in
`src/lib/dept-data.ts`) mitigates this by deferring `objects.json` until the
user opens the `/objects` tab, but the click that triggers it still incurs
the full 650 MB on DepEd.

## What we tried

**Convert the heavy tables to year-partitioned Parquet via DuckDB,
serve them as static files, and run all reads as `read_parquet(...)` queries
in the browser via `@duckdb/duckdb-wasm`.**

The browser fetches over HTTP Range, so DuckDB only pulls the row groups +
columns it actually needs for a given query.

## What we measured (dept 07 / DepEd)

Conversion result on the heavy tables (Hive-partitioned by `year`):

| Source JSON | Parquet (sum of `year=*/data_0.parquet`) | Ratio |
|---|---:|---:|
| `objects.json` 650 MB | 125 MB | 5.2× |
| `expenses.json` 69 MB | 11.4 MB | 6.1× |
| `fund_subcategories.json` 50 MB | 6.2 MB | 8.2× |
| `operating_units.json` 17 MB | 3.4 MB | 4.9× |
| `fpaps.json` 141 KB | 76 KB | 1.9× |
| **TOTAL** | **786 MB → 145 MB** | **5.4×** |

A single-file parquet (no Hive partitioning) compressed dept 07 objects to
**38 MB (17×)**, but with no usable row-group pruning — `ORDER BY year` was
dropped by parallel COPY, so every row group spanned 2020–2026 and DuckDB
could not skip any. **Hive partitioning trades total disk size (38 → 125 MB
for objects) for the ability to fetch one year's file in isolation.** For a
Portal that always renders a chosen year, that's the right trade.

### Bytes-on-wire per query (measured via byte-counting HTTP proxy + libcurl httpfs)

| Query | Files | Bytes transferred | vs. JSON equivalent |
|---|---:|---:|---:|
| Top 10 spending objects in 2026 | 1 | **1.70 MB** | 650 MB → **383×** |
| Yearly trend across 2020–2026 | 7 | 4.39 MB | 650 MB → 148× |
| Expense-class breakdown 2026 | 1 | 190 KB | 69 MB → 369× |
| Count distinct agencies (all years) | 7 | 173 KB | 650 MB → 3,840× |
| Agency-filter top 20 in 2026 | 1 | 2.15 MB | 650 MB → 310× |

Query times (local Vite dev server, warm DuckDB engine): 10–100 ms.

A `HEAD` per opened file is needed once for size discovery, then DuckDB
streams just the parquet footer (~50 KB), then column-chunk pages on demand.

## What we built

| Artifact | Purpose |
|---|---|
| `scripts/convert-to-parquet.ts` | JSON → Hive-partitioned Parquet via `@duckdb/node-api`. `npm run build:parquet -- --all` or `--dept=NN` |
| `scripts/inspect-parquet.ts` | Quick schema/row-group dump for any parquet |
| `scripts/range-probe.ts` | Local HTTP proxy that tallies bytes per URL; runs the 5 representative queries via Node `httpfs` |
| `scripts/col-sizes.ts` | Per-column compressed sizes in a parquet file |
| `src/lib/duckdb.ts` | Singleton `AsyncDuckDB` + connection; `parquetUrls(dept, table, manifest, years?)` builder; `loadManifest(dept)` |
| `src/pages/Explore.tsx` | Demo route at `/explore` that runs four queries against dept 07 partitions and reports byte counts via `PerformanceResourceTiming` |
| `data/{deptId}/parquet_manifest.json` | Per-dept index of `{ table: { years[], bytes } }` — replaces HTTP directory listing |
| `vite.config.ts` | COOP/COEP headers + `optimizeDeps.exclude: ['@duckdb/duckdb-wasm']` + `worker.format: 'es'` |

## Architecture recommendation

### Hybrid: keep small JSON, route heavy tables through DuckDB-WASM

```
public/data/{dept}/
├── departments.json           ─┐
├── agencies.json               │ → keep as JSON, Stage A loader (unchanged)
├── yearly_totals.json         ─┘
├── parquet_manifest.json      → small, fetched first
├── objects/year=YYYY/data_0.parquet
├── expenses/year=YYYY/data_0.parquet
├── fund_subcategories/year=YYYY/data_0.parquet
├── operating_units/year=YYYY/data_0.parquet
└── fpaps/year=YYYY/data_0.parquet
```

| Loader stage | Mechanism | Payload |
|---|---|---|
| A · Masthead, KPI, year trend | fetch JSON | ~50 KB (unchanged) |
| B · Hierarchy drill-in | DuckDB-WASM SQL against parquet | per-query 200 KB – 5 MB |
| C · Objects/data export | DuckDB-WASM streaming arrow | per-query 200 KB – 5 MB |

The current `dept-data.ts` Stage A is fine and stays. Stages B and C move
from JSON fetches to `runQuery(...)` calls keyed by current filter state
(year selector, agency selector, op-unit selector). The page no longer holds
the full dept's data in memory — it holds the last query result.

### Why this is the right shape

1. **Per-query bytes 100–1000× smaller** than the equivalent JSON parse.
2. **Constant-time worst case**: DepEd is no longer punishingly different
   from DOF because we only pay for what we render.
3. **Same code path for cross-dept queries**: a single parquet manifest at
   `/data/national/*.parquet` would let `/` join across all 40 departments
   without orchestrating 40 fetches.
4. **Static hosting still works**: Range requests are honored by every
   serious CDN (Cloudflare R2, Vercel, Netlify, GH Pages all do this).
5. **CSV export trivially**: DuckDB writes CSV/Excel directly from queries.

### Costs and caveats

- **Bundle weight**: `@duckdb/duckdb-wasm` adds ~6 MB gzipped (wasm + worker)
  on first load. Code-split it behind a `lazy()` route boundary; users who
  never enter a Portal pay nothing.
- **Cross-origin isolation**: the multi-threaded `eh` bundle needs COOP/COEP
  headers (`Cross-Origin-Embedder-Policy: require-corp`,
  `Cross-Origin-Opener-Policy: same-origin`). Configured for dev; production
  host must set them too, otherwise we fall back to the slower `mvp` bundle.
- **Disk size increases ~3× for objects** vs. an unsorted single-file
  parquet, because per-year files can't share a dictionary. Net of JSON it's
  still 5× smaller.
- **DuckDB-WASM `httpfs` does not glob directories** — hence the manifest.
  `read_parquet([url1, url2, ...])` works fine.
- **Build step required**: `npm run build:parquet -- --all` must run before
  deploy. Estimated total runtime ≈ 5–8 min for all 40 depts on this box
  (dept 07 alone took 33 s).
- **Long-lived parquet schema**: any change requires re-running the
  converter. Acceptable for a snapshot-based budget dataset that updates
  yearly.

## Changes to PLAN.md if we adopt this

- Phase 1 unchanged (scaffold + design system port — already done on main).
- Phase 2: rewrite `loadDeptMidInto` and `loadDeptObjectsInto` as
  query-driven hooks (`useQuery<Row[]>(sql, deps)`) backed by `duckdb.ts`.
  The component tree keeps using the same `DeptData` shape but materializes
  it lazily per panel.
- Phase 3 (`/` National page): drop the build-time `build-national-index.ts`
  if/when we generate `public/data/national/*.parquet` from the union of all
  depts' partitioned files. For v1 we can keep the JSON index and only swap
  the Portal — National stays static and small.
- New script `scripts/build-parquet-tree.ts` (this branch) replaces the
  raw-JSON public copy for heavy tables.
- `vite.config.ts` permanently gets COOP/COEP + `optimizeDeps.exclude`.
- `package.json` gains `@duckdb/duckdb-wasm` (dep), `@duckdb/node-api`
  (devDep), `npm run build:parquet`.

## Try it

```bash
# 1. Generate parquet for dept 07 (already done on this branch)
npm run build:parquet -- --dept=07

# 2. Dev server
npm run dev   # port 5175 on this box

# 3. Open the demo
open http://localhost:5175/explore

# 4. Re-run the Node-side byte probe
npx tsx scripts/range-probe.ts
```

## Suggested next steps if we adopt

1. Convert all 40 depts: `npm run build:parquet -- --all` (≈5–8 min)
2. Upload to R2: `npm run upload:r2 -- --all` (≈3–6 GB, depends on link)
3. Add a thin React hook `useDuckQuery<Row>(sql, deps)` over `runQuery`
4. Rewrite Portal's Hierarchy / Objects / Data views as queries
5. Decide on a national-rollup parquet (union of all dept files) vs.
   keeping `national/index.json` for the landing page
6. Add a `npm run build` step that fails if any dept lacks a manifest

## Hosting on Cloudflare R2 (BetterGov account)

The parquet tree is served from R2 in production. Range requests are
honored natively, no Worker needed.

### Bucket

- Account: **BetterGov** (`cd41784b73cc20f93b3137292f818ff6`)
- Bucket: **`budget`** (location: **APAC**)
- Public custom domain: **`https://budget-assets.bettergov.ph`**
- Layout in bucket mirrors `data/`:
  ```
  {deptId}/parquet_manifest.json
  {deptId}/{table}/year=YYYY/data_0.parquet
  ```
- Final read URLs look like:
  `https://budget-assets.bettergov.ph/07/objects/year=2026/data_0.parquet`

### One-time R2 dashboard setup

Bucket settings:
`https://dash.cloudflare.com/cd41784b73cc20f93b3137292f818ff6/r2/default/buckets/budget`

Custom domain `budget-assets.bettergov.ph` is already attached (✓).
Two things remain:

1. **CORS** — Settings → CORS Policy → Add CORS policy:
   ```json
   [
     {
       "AllowedOrigins": [
         "http://localhost:5175",
         "https://ai-reports.bettergov.ph"
       ],
       "AllowedMethods": ["GET", "HEAD"],
       "AllowedHeaders": ["Range", "If-Modified-Since", "If-None-Match"],
       "ExposeHeaders": ["Content-Length", "Content-Range", "ETag"],
       "MaxAgeSeconds": 3600
     }
   ]
   ```
   `Range` **must** be in `AllowedHeaders` — without it, DuckDB-WASM
   falls back to full-file GETs and the lazy load story dies. Replace
   the prod origin with the actual app host when known.

2. **API token** — Settings → API tokens → Create token, scope
   *Object Read & Write* on `budget`. Drop the access key + secret into
   a local `.env` (not committed):
   ```
   R2_ACCOUNT_ID=cd41784b73cc20f93b3137292f818ff6
   R2_ACCESS_KEY_ID=...
   R2_SECRET_ACCESS_KEY=...
   R2_BUCKET=budget
   ```

### Uploading

```bash
# One dept
npm run upload:r2 -- --dept=07

# All 40 (after build:parquet --all)
npm run upload:r2 -- --all

# Preview what would upload
npm run upload:r2 -- --all --dry-run
```

The script skips files whose key already exists at the same size, so
re-running after a partial upload only sends the missing tail.

### Pointing the browser at R2

```
# .env.local (or build-time env)
VITE_DATA_BASE_URL=https://budget-assets.bettergov.ph
```

`src/lib/data-url.ts` resolves all data asset URLs against this. Used by:

- `dept-data.ts` for the Stage A JSONs (`departments`, `agencies`,
  `yearly_totals`)
- `duckdb.ts` for `parquet_manifest.json` + the parquet files
- `National.tsx` for `national/index.json`

With the env var unset, everything falls back to local `/data/`, so dev
keeps working off disk without an R2 round-trip.

### What lives in the bucket vs. on disk

Uploaded to R2 (used by the running site):

```
{deptId}/departments.json             ~1 KB each
{deptId}/agencies.json                ~5 KB each
{deptId}/yearly_totals.json           ~750 B each
{deptId}/parquet_manifest.json        ~750 B each
{deptId}/{table}/year=YYYY/data_0.parquet
national/index.json                   ~33 KB
```

Bucket size: **~510 MB** total (38 depts).

Kept local only (source-of-truth + offline analysis):

```
{deptId}/objects.json
{deptId}/expenses.json
{deptId}/fund_subcategories.json
{deptId}/operating_units.json
{deptId}/fpaps.json
{deptId}/full_extract.csv
{deptId}/REPORT.md, REPORT_PROMPT.md
EXECUTIVE_SYNTHESIS.md
```

### Loader cutover

`src/lib/dept-data.ts` now serves:

- **Stage A** (`loadDeptData`) — still JSON: `departments.json`,
  `agencies.json`, `yearly_totals.json` (small Stage A bundle, ~10 KB).
- **Stage B** (`loadDeptMidInto`) — parquet via DuckDB-WASM. Issues
  parallel `read_parquet([...])` queries for fpaps / operating_units /
  fund_subcategories / expenses, reshapes the year-unpivoted rows back
  into the existing `RawDataset<T>` envelope so `Portal.tsx` is unchanged.
- **Stage C** (`loadDeptObjectsInto`) — parquet via DuckDB-WASM.

The browser pays a one-time ~6 MB gzipped wasm bundle on the first
Portal visit; each subsequent dept switches just reuses the worker.

### Cleanup

The heavy Stage B/C JSONs have been deleted from R2 (`scripts/cleanup-r2-jsons.ts`).
To restore them if needed: `npm run upload:r2 -- --all --force` — they
still live under `data/{deptId}/*.json` on disk.

### Per-month cost ballpark (R2)

- Storage: ~3 GB × $0.015/GB-mo ≈ **$0.05/mo**
- Class A (writes): one-time bulk upload of ~1,400 objects ≈ **$0.01**
- Class B (reads): each parquet query → 5–20 GET/HEAD requests.
  10k page views × 8 queries × 10 reqs ≈ 800k Class B at $0.36/M ≈
  **$0.29/mo**
- Egress: **free** (this is the R2 win vs S3)

So well under a dollar a month at expected national-traffic scale.
