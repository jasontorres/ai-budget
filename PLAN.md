# ai-reports — Philippines GAA Budget Browser

## Context

`ai-reports/` is a greenfield project that will browse the entire Philippines General Appropriations Act (GAA) budget across all 40 departments for FY 2020–2026. The data has already been generated under `data/` — 40 department folders, each containing the same 7-level UACS hierarchy (`departments → agencies → fpaps → operating_units → fund_subcategories → expenses → objects`) plus `yearly_totals.json` and a `full_extract.csv` audit trail. Total ~3.7GB.

The sister project `dict-budget/` is a finished, production-quality budget browser for the **single** DICT department, built in React 19 + Vite + React Router 7 with a custom "editorial data journalism" CSS design system, hand-rolled SVG charts, and a hierarchical Portal layout. **Its JSON schema is identical to ai-reports' per-department data** — the dict-budget data loader, types, and Portal page were effectively designed for the GAA schema and can be reused with minimal change.

**Goal:** Build a national-scale budget browser by reusing dict-budget's design language verbatim, adding a national-rollup landing experience, and lazy-loading per-department data on drill-in.

---

## Design extracted from dict-budget

**Stack to mirror:**
- React 19 + TypeScript + Vite 8 + React Router 7
- Pure CSS, no UI framework, no chart library
- Static JSON in `public/data/`, fetched at runtime
- React hooks only for state (`useState`, `useMemo`, `useRef`)

**Visual language (copy verbatim from `dict-budget/src/styles.css`):**
- Paper-and-ink palette: `--paper #ffffff`, `--paper-2 #f7f5f0`, `--ink #16140f`, `--rule #d6cab0`
- Editorial red accent: `--accent #b8341f`
- 7-step warm sequential `--stage-1`…`--stage-7` for data-driven coloring
- Expense-class palette: `--ec-ps`, `--ec-mooe`, `--ec-co`, `--ec-fe`
- Typography: Manrope (hero), JetBrains Mono (heads/data), Inter Tight (body)
- Sticky masthead with thin nav, card layout with hairline borders, no shadows, monospace data tick labels

**Component primitives to reuse from `dict-budget/src/components/shared.tsx`:**
- `Eyebrow`, `Headline`, `Dek`, `SectionHead`, `Pill`, `Spark` (inline SVG sparkline)

**Data shape to reuse from `dict-budget/src/lib/types.ts`:**
- `Department`, `Agency`, `FPAP`, `OperatingUnit`, `Fund`, `Expense`, `ObjectItem` — all already correctly modeled for GAA
- `FPAPFamily` rename-tracking, `ExpenseClassBreakdown` (PS/MOOE/CO/FE), `MoverEntry`
- The `DictData` aggregate type will be renamed `DeptData` and represent one department's bundle

---

## Information architecture

Three-tier navigation:

```
National Overview (/)         all 40 depts, year totals, top spenders, sector rollups
  └─ Department Portal (/d/:deptId)   one dept, mirrors dict-budget Portal
       └─ Hierarchy drill-in           Agency → FPAP → Op.Unit → Fund → Expense → Object
```

Plus a static `/methodology` page surfacing the data-quality caveats from `data/EXECUTIVE_SYNTHESIS.md` (UACS recoding 2025→2026, FPAP renames, off-GAA migrations, pseudo-departments).

---

## Routes

| Path | Component | Purpose |
|---|---|---|
| `/` | `National` | Landing: national totals, dept ranking, year trend, top movers across all depts |
| `/by-year` | `National` (view tab) | National year-over-year breakdown |
| `/departments` | `National` (view tab) | Full sortable department list with sparklines |
| `/d/:deptId` | `Portal` | Per-dept dashboard (= existing dict-budget Portal, parameterized) |
| `/d/:deptId/overview` `/by-year` `/programs` `/objects` `/data` | `Portal` | Existing dict-budget Portal view tabs |
| `/methodology` | `Methodology` | Static page citing EXECUTIVE_SYNTHESIS caveats |
| `*` | `Navigate to="/"` | Fallback |

`Review` and `Future` scrollytelling narratives are **out of scope for v1** — they need original national-context editorial copy. The scrollytelling utility (`src/lib/scrollytelling.ts`) is still worth porting for future use.

---

## Data loading strategy

The full dataset is 3.7GB — cannot ship to the browser. Strategy:

1. **Build-time aggregator** (`scripts/build-national-index.ts`, Node script):
   - Reads each `data/{deptId}/departments.json` and `yearly_totals.json`
   - Emits `public/data/national/index.json` containing: department list (id, name, slug, years totals, sector tag), national `yearly_totals`, top-10 movers across depts
   - Also emits `public/data/national/sector_map.json` (manual classification of pseudo-depts 04/26/28/35/36 vs operating depts, derived from EXECUTIVE_SYNTHESIS)
   - Total emitted ≤ ~200KB

2. **Per-department lazy load**:
   - On entering `/d/:deptId`, fetch `/data/{deptId}/agencies.json` `fpaps.json` `operating_units.json` `fund_subcategories.json` `expenses.json` `objects.json` `yearly_totals.json` in parallel (mirrors `dict-data.ts` `loadDictData()`)
   - Cache loaded `DeptData` in a React context keyed by `deptId` so switching back is instant
   - Two-department guardrails: DepEd (07 = 1.5GB) and DPWH (18 = 1.1GB) — sample first to confirm `objects.json` for those isn't multi-hundred-MB. If it is, lazy-load `objects.json` only when the user opens the `/objects` tab (split from the initial parallel fetch).

3. **Static asset routing**:
   - `data/` is copied wholesale to `public/data/` either by symlink or `vite-plugin-static-copy`. Add `.gitignore` for the heavy depts in `public/data/` so we don't accidentally commit gigabytes.
   - `full_extract.csv` files are **not** served by default — kept in `data/` for offline analysis. If a per-dept "download raw" link is needed, it streams from a `/raw/{deptId}.csv` route, not bundled.

---

## Implementation phases

### Phase 1 — Scaffold + design system port

- `npm create vite@latest ai-reports -- --template react-ts` (in `/home/jason/projects/ai-reports`, alongside existing `data/`)
- Match `dict-budget/package.json` deps exactly: react@19, react-dom@19, react-router-dom@7
- Copy verbatim:
  - `src/styles.css`, `src/portal.css`, `src/responsive.css`, `src/index.css`
  - `src/components/shared.tsx`, `src/components/SiteFooter.tsx`
  - `src/lib/format.ts`, `src/lib/csv.ts`, `src/lib/scrollytelling.ts`, `src/lib/data-loader.ts`
- Update masthead title from "DICT Budget" → "Philippines GAA"; keep accent color verbatim per design-fidelity decision
- Configure `vite.config.ts` to serve `public/data` and skip the big CSVs (use `publicDir` + a copy plugin filter)

### Phase 2 — Per-department Portal (the easy win)

- Adapt `src/lib/dict-data.ts` → `src/lib/dept-data.ts`:
  - `loadDeptData(deptId: string)` — parameterize the URL base to `/data/{deptId}/`
  - Rename `DictData` → `DeptData` in `src/lib/types.ts`
  - Keep all aggregation logic (`fpapFamilies`, `expenseClassByYear`, `topMovers`) — it operates per-department and is reusable as-is
- Copy `src/pages/Portal.tsx` verbatim
  - Add `useParams` to read `:deptId`
  - Wrap `loadDeptData(deptId)` in `useEffect`; show skeleton while loading
  - Update the masthead breadcrumb: `Philippines GAA › <Department Name>`
- Mount under `/d/:deptId/*` routes

**Acceptance:** navigating to `/d/05` shows a working DepEd-style Portal identical in look to current dict-budget, populated with dept 05 (DOF) data.

### Phase 3 — National landing page (`/`)

- New `scripts/build-national-index.ts` — run via `npm run build:index`. Reads `data/*/departments.json` + `yearly_totals.json`, writes `public/data/national/index.json`.
- New `src/pages/National.tsx`:
  - **KPI strip** (reuses Portal's KPI strip pattern): national total this year, YoY growth, peak year, 7-yr CAGR, count of depts
  - **Year-trend hero** — stacked bar or line chart of national totals 2020–2026 (hand-rolled SVG, same `<Spark>` style)
  - **Department ranking table** — sortable, filterable, with inline sparklines (reuse `<Spark>`); click row → `/d/:deptId`
  - **Top movers section** — biggest dept-level YoY swings across all 40 (uses the same `MoverEntry` shape)
  - **Sector breakdown card** — operating depts vs. pseudo-depts (Automatic Appropriations 04, BSGC 26, ALGU 28, Unprogrammed 35, OEOs 36) using `sector_map.json`
- New `src/lib/national-data.ts` — loader for the national index file (small, single fetch)

### Phase 4 — Methodology page

- New `src/pages/Methodology.tsx` — static markdown-style content
- Source content from `data/EXECUTIVE_SYNTHESIS.md` §5 (data quality) and §6 (reader's contract). Surface specifically:
  - UACS object recoding 2025→2026 (object-level YoY unreliable)
  - 1,446 FPAP renames in DPWH flood control
  - IRA→NTA rename
  - PhilHealth, PS-DBM, SEC, NEA, TPB/TIEZA live outside the GAA
  - DAR misclassification under Automatic Appropriations
- The Portal's `<Pill>` component is reused inline to tag caveats next to data points.

### Phase 5 — Polish

- Empty/loading skeletons for `/d/:deptId` while JSON loads
- Error boundary if a dept's JSON 404s
- Robots/meta tags
- 404 + back-to-national fallback

---

## Critical files to be created or modified

**New (in `/home/jason/projects/ai-reports`):**
- `package.json`, `vite.config.ts`, `tsconfig*.json`, `index.html`, `eslint.config.js`
- `src/main.tsx`, `src/App.tsx` (router)
- `src/pages/National.tsx` — new landing
- `src/pages/Portal.tsx` — adapted from dict-budget
- `src/pages/Methodology.tsx` — new static page
- `src/lib/dept-data.ts` — adapted from `dict-budget/src/lib/dict-data.ts`
- `src/lib/national-data.ts` — new
- `src/lib/types.ts` — adapted from dict-budget
- `scripts/build-national-index.ts` — new build-time aggregator
- `public/data/national/index.json` — build output
- `public/data/national/sector_map.json` — hand-authored
- `public/data/{01..40}/` — symlinked or copied from `data/{01..40}/`

**Copied verbatim from dict-budget:**
- `src/styles.css`, `src/portal.css`, `src/responsive.css`, `src/index.css`
- `src/components/shared.tsx`, `src/components/SiteFooter.tsx`
- `src/lib/format.ts`, `src/lib/csv.ts`, `src/lib/scrollytelling.ts`, `src/lib/data-loader.ts`

**Reused logic with no edits needed:**
- `totalOver`, `maxOver`, `normName` (dict-data.ts)
- FPAPFamily aggregation
- Expense-class breakdown
- `topMovers`
- `<Spark>` sparkline component
- All CSS design tokens

---

## Verification

After Phase 2:
- `npm run dev` → open `http://localhost:5173/d/05`
- Compare side-by-side with `dict-budget` at `http://localhost:5174` — visual parity confirmed
- Check `/d/07` (DepEd, 1.5GB raw) loads in <5s; if `objects.json` is the bottleneck, defer it to the `/objects` tab
- Verify CSV export still works (reuses `lib/csv.ts`)

After Phase 3:
- `/` shows non-zero national total ≈ ₱6.79T for 2026 (sanity-check against EXECUTIVE_SYNTHESIS)
- Department ranking has 40 rows
- Click a department row → lands on `/d/:deptId` with that dept's Portal
- Top movers across depts surfaces the IRA→NTA jump and the flood-control swings

After Phase 4:
- `/methodology` renders all five caveat sections
- Internal links from Portal hierarchy items with renames open the relevant caveat anchor

End-to-end smoke test: a fresh user lands on `/`, picks a department, drills Agency → FPAP → Object, exports a CSV, hits Back, and lands on the same National view scroll position.
