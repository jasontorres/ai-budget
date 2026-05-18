import { useEffect, useMemo, useRef, useState, Fragment } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  isMidHeavy,
  isObjectsHeavy,
  loadDeptData,
  loadDeptMidInto,
  loadDeptObjectsInto,
  midSizeHintMb,
  objectsSizeHintMb,
  YEARS,
} from '../lib/dept-data';
import * as fmt from '../lib/format';
import { Eyebrow, SectionHead, Spark } from '../components/shared';
import SiteFooter from '../components/SiteFooter';
import SiteHeader from '../components/SiteHeader';
import { buildColumns, buildRow, downloadCsv, filterObjects, objectsToCsv } from '../lib/csv';
import type { ColumnDef, ObjectFilter, RawCell } from '../lib/csv';
import type { DeptData, FPAP, ObjectItem, BaseEntity, MoverEntry } from '../lib/types';

const FALLBACK_YEAR = 2026;

const VIEW_BY_SUFFIX: Record<string, View> = {
  '': 'hierarchy',
  '/': 'hierarchy',
  '/overview': 'hierarchy',
  '/by-year': 'byyear',
  '/programs': 'programs',
  '/objects': 'objects',
  '/data': 'data',
  '/methodology': 'methodology',
};

const SUFFIX_BY_VIEW: Record<View, string> = {
  hierarchy: '/overview',
  byyear: '/by-year',
  programs: '/programs',
  objects: '/objects',
  data: '/data',
  methodology: '/methodology',
};

function pathSuffix(pathname: string, deptId: string): string {
  const prefix = `/d/${deptId}`;
  if (pathname === prefix) return '';
  if (pathname.startsWith(prefix + '/')) return pathname.slice(prefix.length);
  return pathname;
}

type View = 'hierarchy' | 'byyear' | 'programs' | 'objects' | 'data' | 'methodology';

interface DownloadButtonProps {
  data: DeptData;
  filter: ObjectFilter;
  filename: string;
  label?: string;
  variant?: 'inline' | 'pill';
  disabled?: boolean;
}

function DownloadCsvButton({
  data,
  filter,
  filename,
  label,
  variant = 'inline',
  disabled,
}: DownloadButtonProps) {
  const matched = useMemo(() => filterObjects(data, filter), [data, filter]);
  const isDisabled = disabled || matched.length === 0;
  const text = label != null ? label : `Download CSV · ${matched.length.toLocaleString()} rows`;
  return (
    <button
      type="button"
      className={`csv-btn csv-btn-${variant}`}
      disabled={isDisabled}
      onClick={() => {
        if (isDisabled) return;
        const csv = objectsToCsv(data, matched);
        downloadCsv(filename, csv);
      }}
    >
      <span className="csv-btn-arrow">↓</span>
      <span>{text}</span>
    </button>
  );
}

function delta(curr: number, prev: number | null | undefined): number | null {
  if (!prev) return null;
  return (curr - prev) / prev;
}
function trendArr(rec: BaseEntity): number[] {
  return YEARS.map((y) => rec.years[y]?.amount || 0);
}
function maxAcrossYears(records: BaseEntity[]): number {
  let m = 0;
  records.forEach((r) =>
    YEARS.forEach((y) => {
      const v = r.years[y]?.amount || 0;
      if (v > m) m = v;
    }),
  );
  return m;
}

/* ---------- KPI strip ---------- */
function KpiStrip({ data, hideOnMobile }: { data: DeptData; hideOnMobile?: boolean }) {
  const totalNow = data.total(2026);
  const totalPrev = data.total(2020);
  const growth = delta(totalNow, totalPrev);
  const yoy = delta(data.total(2026), data.total(2025));
  const peak = Math.max(...YEARS.map((y) => data.total(y)));
  const peakYear = YEARS.find((y) => data.total(y) === peak);

  return (
    <div className={`kpi-strip ${hideOnMobile ? 'kpi-strip-hide-mobile' : ''}`}>
      <div className="kpi-cell">
        <p className="kpi-label">FY 2026 Appropriation</p>
        <p className="kpi-value">{fmt.php(totalNow, { unit: 'B' })}</p>
        <p className={`kpi-sub ${(yoy ?? 0) > 0 ? 'up' : 'down'}`}>{fmt.signedPct(yoy)} vs. 2025</p>
      </div>
      <div className="kpi-cell">
        <p className="kpi-label">7-Year Growth</p>
        <p className="kpi-value">{fmt.signedPct(growth, 0)}</p>
        <p className="kpi-sub">
          {fmt.php(totalPrev, { unit: 'B' })} → {fmt.php(totalNow, { unit: 'B' })}
        </p>
      </div>
      <div className="kpi-cell">
        <p className="kpi-label">Peak Year</p>
        <p className="kpi-value">FY {peakYear}</p>
        <p className="kpi-sub">{fmt.php(peak, { unit: 'B' })}</p>
      </div>
      <div className="kpi-cell">
        <p className="kpi-label">Bureaus Tracked</p>
        <p className="kpi-value">{data.agencies.length}</p>
        <p className="kpi-sub">OSEC · NTC · NPC · CICC</p>
      </div>
    </div>
  );
}

/* ---------- Trend chart ---------- */
function TrendChart({ data, height = 260 }: { data: DeptData; height?: number }) {
  const w = 1000;
  const h = height;
  const pad = { l: 56, r: 24, t: 18, b: 36 };
  const innerW = w - pad.l - pad.r;
  const innerH = h - pad.t - pad.b;

  const values = YEARS.map((y) => data.total(y));
  const maxV = Math.max(...values) * 1.1;
  const x = (i: number) => pad.l + (i / (YEARS.length - 1)) * innerW;
  const y = (v: number) => pad.t + innerH - (v / maxV) * innerH;
  const barW = (innerW / YEARS.length) * 0.55;

  const pts = values.map((v, i) => `${x(i)},${y(v)}`).join(' ');
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => maxV * t);

  return (
    <div className="trend">
      <div className="trend-title">
        <h2>{data.department.description} · total appropriation, FY 2020 – 2026</h2>
        <span className="meta">SOURCE: GENERAL APPROPRIATIONS ACT · ₱ BILLIONS</span>
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={pad.l} x2={w - pad.r} y1={y(t)} y2={y(t)} stroke="var(--rule-soft)" strokeWidth="1" />
            <text
              x={pad.l - 8}
              y={y(t) + 4}
              textAnchor="end"
              style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fill: 'var(--ink-3)' }}
            >
              {fmt.shortPhp(t, 'B')}
            </text>
          </g>
        ))}
        {values.map((v, i) => (
          <rect
            key={i}
            x={x(i) - barW / 2}
            y={y(v)}
            width={barW}
            height={innerH - (y(v) - pad.t)}
            fill="var(--accent-soft)"
          />
        ))}
        <polyline points={pts} fill="none" stroke="var(--accent-deep)" strokeWidth="2" />
        {values.map((v, i) => (
          <g key={i}>
            <circle cx={x(i)} cy={y(v)} r={4} fill="var(--accent-deep)" />
            <text
              x={x(i)}
              y={y(v) - 12}
              textAnchor="middle"
              style={{ fontFamily: 'var(--font-hero)', fontSize: 12, fontWeight: 700, fill: 'var(--ink)' }}
            >
              {fmt.shortPhp(v, 'B')}
            </text>
            <text
              x={x(i)}
              y={h - 14}
              textAnchor="middle"
              style={{ fontFamily: 'var(--font-mono)', fontSize: 11, fill: 'var(--ink-3)' }}
            >
              {YEARS[i]}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}

/* ---------- Expense-class composition stack ---------- */
function ExpenseClassStack({ data, year }: { data: DeptData; year: number }) {
  const breakdown = data.expenseClassByYear[year];
  const total = breakdown.PS + breakdown.MOOE + breakdown.CO + breakdown.FE;
  if (!total) return null;
  const cells = [
    { key: 'PS', label: 'Personnel', color: 'var(--ec-ps)', value: breakdown.PS },
    { key: 'MOOE', label: 'Operating', color: 'var(--ec-mooe)', value: breakdown.MOOE },
    { key: 'CO', label: 'Capital Outlays', color: 'var(--ec-co)', value: breakdown.CO },
    { key: 'FE', label: 'Financial', color: 'var(--ec-fe)', value: breakdown.FE },
  ].filter((c) => c.value > 0);
  return (
    <div>
      <div className="ec-stack">
        {cells.map((c) => {
          const p = c.value / total;
          return (
            <div
              key={c.key}
              style={{ width: `${p * 100}%`, background: c.color }}
              title={`${c.label}: ${fmt.php(c.value, { unit: 'B' })} (${fmt.pct(p, 0)})`}
            >
              {p > 0.06 ? `${c.label.toUpperCase()} ${fmt.pct(p, 0)}` : ''}
            </div>
          );
        })}
      </div>
      <div className="ec-legend">
        {cells.map((c) => (
          <span key={c.key}>
            <span className="swatch" style={{ background: c.color }}></span>
            {c.label} · {fmt.php(c.value, { unit: 'B' })} ({fmt.pct(c.value / total, 0)})
          </span>
        ))}
      </div>
    </div>
  );
}

/* ---------- Hierarchy row ---------- */
function HierarchyRow({
  rec,
  year,
  max,
  prevYear,
  onClick,
  drillable,
  label,
}: {
  rec: BaseEntity;
  year: number;
  max: number;
  prevYear: number | null;
  onClick?: () => void;
  drillable: boolean;
  label?: string;
}) {
  const v = rec.years[year]?.amount || 0;
  const prev = prevYear ? rec.years[prevYear]?.amount || 0 : null;
  const d = prev != null ? delta(v, prev) : null;
  const p = max ? v / max : 0;

  return (
    <tr className={drillable ? '' : 'disabled'} onClick={drillable ? onClick : undefined}>
      <td className="name">
        <span>{rec.description}</span>
        {label && <span className="desc">{label}</span>}
      </td>
      <td className="bar-cell">
        <div className="bar-h accent">
          <span style={{ width: `${p * 100}%` }}></span>
        </div>
      </td>
      <td className="num">{fmt.php(v, { unit: v >= 1e9 ? 'B' : 'M' })}</td>
      <td className="num">
        {d == null ? (
          <span className="delta">—</span>
        ) : (
          <span className={`delta ${d > 0 ? 'up' : 'down'}`}>{fmt.signedPct(d, 0)}</span>
        )}
      </td>
      <td className="spark-cell">
        <Spark values={trendArr(rec)} w={88} h={22} color="var(--ink-2)" />
      </td>
      {drillable && <td className="chev">›</td>}
    </tr>
  );
}

/* ---------- Year strip (prominent, used across year-aware views) ---------- */
function YearStrip({
  data,
  year,
  setYear,
}: {
  data: DeptData;
  year: number;
  setYear: (y: number) => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const peak = Math.max(...YEARS.map((y) => data.total(y)));

  function pickYear(y: number) {
    setYear(y);
    const el = wrapRef.current;
    if (!el) return;
    const masthead = document.querySelector('.masthead') as HTMLElement | null;
    const offset = (masthead?.offsetHeight ?? 0) + 12;
    const top = el.getBoundingClientRect().top + window.scrollY - offset;
    window.scrollTo({ top, behavior: 'smooth' });
  }

  return (
    <div ref={wrapRef} className="year-strip-wrap">
      <p className="eyebrow">Pick a fiscal year</p>
      <div className="year-strip" role="tablist" aria-label="Fiscal year">
        {YEARS.map((y) => {
          const v = data.total(y);
          const p = peak ? (v / peak) * 100 : 0;
          const active = y === year;
          return (
            <button
              key={y}
              type="button"
              role="tab"
              aria-selected={active}
              className={`year-cell ${active ? 'active' : ''}`}
              onClick={() => pickYear(y)}
            >
              <div className="year-cell-num">FY {y}</div>
              <div className="year-cell-meta">{fmt.shortPhp(v, 'B')} GAA</div>
              <div className="year-cell-bar">
                <span style={{ width: `${p}%` }} />
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ---------- Hierarchy view ---------- */
type PathEntry = { level: 'agency' | 'fpap' | 'opUnit' | 'fund'; id: string; label: string };

function HierarchyView({
  data,
  year,
  setYear,
  midState,
  midError,
  onRequestMid,
  deptId,
}: {
  data: DeptData;
  year: number;
  setYear: (y: number) => void;
  midState: StageState;
  midError: string | null;
  onRequestMid: () => void;
  deptId: string;
}) {
  const [path, setPath] = useState<PathEntry[]>([]);
  // If user is mid-drill but Stage B data hasn't loaded yet, surface a loader.
  const needsMid = path.length > 0 && !data.midLoaded;

  const current = path[path.length - 1];

  let level: 'agency' | 'fpap' | 'opUnit' | 'fund' | 'expense' = 'agency';
  let records: BaseEntity[] = [];
  let drillable = true;
  let parentLabel = '';
  let levelTitle = '';

  if (!current) {
    level = 'agency';
    records = data.agencies;
    drillable = true;
    parentLabel = 'Department of Information and Communications Technology';
    levelTitle = 'Bureaus';
  } else if (current.level === 'agency') {
    level = 'fpap';
    records = (data.fpapsByAgency[current.id] || [])
      .slice()
      .sort((a, b) => (b.years[year]?.amount || 0) - (a.years[year]?.amount || 0));
    drillable = true;
    parentLabel = data.agencyById[current.id].description;
    levelTitle = 'Programs (FPAPs)';
  } else if (current.level === 'fpap') {
    const fpapId = current.id;
    level = 'opUnit';
    records = data.opUnits
      .filter((o) => o.fpap_id === fpapId)
      .sort((a, b) => (b.years[year]?.amount || 0) - (a.years[year]?.amount || 0));
    drillable = true;
    parentLabel = data.fpapById[fpapId].description;
    levelTitle = 'Operating Units';
  } else if (current.level === 'opUnit') {
    const ouId = current.id;
    level = 'fund';
    records = data.funds
      .filter((f) => f.operating_unit_id === ouId)
      .sort((a, b) => (b.years[year]?.amount || 0) - (a.years[year]?.amount || 0));
    drillable = true;
    parentLabel = data.opUnitById[ouId].description;
    levelTitle = 'Funds';
  } else if (current.level === 'fund') {
    const fundId = current.id;
    level = 'expense';
    records = data.expenses
      .filter((e) => e.fund_id === fundId)
      .sort((a, b) => (b.years[year]?.amount || 0) - (a.years[year]?.amount || 0));
    drillable = false;
    parentLabel = data.fundById[fundId].description;
    levelTitle = 'Expense Classes';
  }

  const max = maxAcrossYears(records);
  const prevYear = year > YEARS[0] ? year - 1 : null;

  function drill(rec: BaseEntity) {
    if (level === 'expense') return;
    if (level === 'agency' && !data.midLoaded && midState === 'idle') {
      onRequestMid();
    }
    setPath([...path, { level, id: rec.id, label: rec.description }]);
  }
  function jump(idx: number) {
    if (idx < 0) setPath([]);
    else setPath(path.slice(0, idx + 1));
  }

  // Build a CSV filter that matches the deepest entry in `path`,
  // so a download from this branch only includes its line items.
  const csvFilter: ObjectFilter = (() => {
    const f: ObjectFilter = {};
    for (const p of path) {
      if (p.level === 'agency') f.agencyId = p.id;
      else if (p.level === 'fpap') f.fpapId = p.id;
      else if (p.level === 'opUnit') f.operatingUnitId = p.id;
      else if (p.level === 'fund') f.fundId = p.id;
    }
    return f;
  })();
  const deptSlug = data.department.description
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
  const csvLabel =
    path.length === 0 ? `${data.department.description} (all bureaus)` : path[path.length - 1].label;
  const csvFilename =
    path.length === 0
      ? `gaa-${data.department.id}-${deptSlug}-fy2020-2026.csv`
      : `gaa-${data.department.id}-${path[path.length - 1].label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')}.csv`;

  return (
    <div>
      <YearStrip data={data} year={year} setYear={setYear} />

      <div style={{ marginBottom: 14, marginTop: 28 }}>
        <Eyebrow>Hierarchy · drill from department to expense class</Eyebrow>
      </div>

      <div className="crumbs">
        <button onClick={() => jump(-1)}>{data.department.description}</button>
        {path.map((p, i) => (
          <Fragment key={i}>
            <span className="sep">›</span>
            <button onClick={() => jump(i)}>{p.label}</button>
          </Fragment>
        ))}
        <span className="sep">›</span>
        <span className="current">{levelTitle}</span>
        <span className="crumb-download">
          <DownloadCsvButton
            data={data}
            filter={csvFilter}
            filename={csvFilename}
            label={`Download line items · ${csvLabel}`}
            variant="pill"
          />
        </span>
      </div>

      {needsMid ? (
        <StageLoader
          stage="mid"
          state={midState}
          error={midError}
          deptId={deptId}
          onLoad={midState === 'idle' ? onRequestMid : undefined}
        />
      ) : (
        <>
          <table className="hier-table">
            <thead>
              <tr>
                <th>{levelTitle.toUpperCase()}</th>
                <th>SHARE OF MAX</th>
                <th className="right">FY {year}</th>
                <th className="right">YoY</th>
                <th>2020 — 2026</th>
                {(level === 'agency' || level === 'fpap' || level === 'opUnit' || level === 'fund') && <th></th>}
              </tr>
            </thead>
            <tbody>
              {records.length === 0 && (
                <tr className="disabled">
                  <td
                    colSpan={6}
                    style={{
                      padding: 24,
                      textAlign: 'center',
                      color: 'var(--ink-3)',
                      fontFamily: 'var(--font-mono)',
                      fontSize: 12,
                    }}
                  >
                    No line items at this level for {parentLabel}.
                  </td>
                </tr>
              )}
              {records.map((rec) => {
                const labelExtra =
                  (rec as FPAP).fpap_code !== undefined
                    ? (rec as FPAP).fpap_code
                    : (rec as { expense_code?: string }).expense_code;
                return (
                  <HierarchyRow
                    key={rec.id}
                    rec={rec}
                    year={year}
                    max={max}
                    prevYear={prevYear}
                    onClick={() => drill(rec)}
                    drillable={drillable}
                    label={labelExtra}
                  />
                );
              })}
            </tbody>
          </table>

          {level === 'expense' && (
            <p className="note-block" style={{ marginTop: 24, borderTop: '1px solid var(--rule)', paddingTop: 18 }}>
              <strong>Why no further drill-down?</strong> Below expense class, the data goes to <em>Object</em>{' '}
              (UACS line items like “Travelling Expenses — Local”). The Philippine UACS catalog was recoded several
              times between FY 2020 and FY 2026, so individual object codes do not align across years and are not
              safe to chart longitudinally. Use the <strong>Programs</strong> tab for cross-year analysis.
            </p>
          )}
        </>
      )}
    </div>
  );
}

/* ---------- Treemap ---------- */
interface TreemapTile {
  id: string;
  name: string;
  agency: string;
  agency_id: string;
  value: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

function Treemap({ data, year, height = 480 }: { data: DeptData; year: number; height?: number }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(1000);
  useEffect(() => {
    if (!wrapRef.current) return;
    const ro = new ResizeObserver((es) => {
      for (const e of es) setW(e.contentRect.width);
    });
    ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, []);

  const items = data.fpaps
    .map((f) => ({
      id: f.id,
      name: f.description,
      agency: data.agencyById[f.agency_id]?.description || '—',
      agency_id: f.agency_id,
      value: f.years[year]?.amount || 0,
    }))
    .filter((i) => i.value > 0)
    .sort((a, b) => b.value - a.value);

  const tiles: TreemapTile[] = [];

  const colorFor = (aid: string) => {
    const idx = data.agencies.findIndex((a) => a.id === aid);
    const palette = ['var(--accent-deep)', '#5a7d2a', '#8c4a1f', '#3a5a7a'];
    return palette[idx % palette.length];
  };

  let remaining = items.slice();
  const H = height;
  const W = w;
  let cur = { x: 0, y: 0, w: W, h: H };
  while (remaining.length > 0) {
    const remTotal = remaining.reduce((s, i) => s + i.value, 0);
    if (!remTotal) break;
    const horizontal = cur.w >= cur.h;
    let row: typeof remaining = [];
    let rowSum = 0;
    let bestRatio = Infinity;
    let i = 0;
    while (i < remaining.length) {
      const next = remaining[i];
      const trial = [...row, next];
      const trialSum = rowSum + next.value;
      const rowArea = (trialSum / remTotal) * (cur.w * cur.h);
      const rowH = horizontal ? rowArea / cur.w : rowArea / cur.h;
      const ratios = trial.map((it) => {
        const itArea = (it.value / trialSum) * rowArea;
        const itLen = horizontal ? itArea / rowH : itArea / rowH;
        const longSide = Math.max(itLen, rowH);
        const shortSide = Math.min(itLen, rowH);
        return longSide / Math.max(shortSide, 0.0001);
      });
      const worst = Math.max(...ratios);
      if (worst <= bestRatio) {
        bestRatio = worst;
        row = trial;
        rowSum = trialSum;
        i++;
      } else {
        break;
      }
    }
    if (row.length === 0) {
      row = [remaining[0]];
      rowSum = remaining[0].value;
    }
    const rowArea = (rowSum / remTotal) * (cur.w * cur.h);
    const rowDim = horizontal ? rowArea / cur.w : rowArea / cur.h;
    let off = 0;
    row.forEach((it) => {
      const itArea = (it.value / rowSum) * rowArea;
      const itLen = horizontal ? itArea / rowDim : itArea / rowDim;
      if (horizontal) {
        tiles.push({ ...it, x: cur.x + off, y: cur.y, w: itLen, h: rowDim });
      } else {
        tiles.push({ ...it, x: cur.x, y: cur.y + off, w: rowDim, h: itLen });
      }
      off += itLen;
    });
    if (horizontal) {
      cur = { x: cur.x, y: cur.y + rowDim, w: cur.w, h: cur.h - rowDim };
    } else {
      cur = { x: cur.x + rowDim, y: cur.y, w: cur.w - rowDim, h: cur.h };
    }
    remaining = remaining.slice(row.length);
    if (cur.w <= 0.5 || cur.h <= 0.5) break;
  }

  return (
    <div ref={wrapRef} className="treemap" style={{ height }}>
      {tiles.map((t) => (
        <div
          key={t.id}
          className="treemap-cell"
          style={{
            left: t.x,
            top: t.y,
            width: t.w,
            height: t.h,
            background: colorFor(t.agency_id),
            fontSize: t.w > 200 && t.h > 80 ? 13 : 11,
          }}
          title={`${t.name} · ${t.agency} · ${fmt.php(t.value, { unit: 'B' })}`}
        >
          {t.w > 60 && t.h > 28 && (
            <>
              <div className="tm-name">{t.name}</div>
              <div className="tm-amount">{fmt.php(t.value, { unit: t.value >= 1e9 ? 'B' : 'M' })}</div>
            </>
          )}
        </div>
      ))}
    </div>
  );
}

/* ---------- Programs view ---------- */
function ProgramsView({
  data,
  year,
  setYear,
}: {
  data: DeptData;
  year: number;
  setYear: (y: number) => void;
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [q, setQ] = useState(() => searchParams.get('q') || '');
  const [agency, setAgency] = useState(() => searchParams.get('agency') || 'all');

  // Reflect filter state back into the URL so the page is shareable.
  useEffect(() => {
    const next = new URLSearchParams();
    if (q) next.set('q', q);
    if (agency !== 'all') next.set('agency', agency);
    setSearchParams(next, { replace: true });
  }, [q, agency, setSearchParams]);

  const rows = useMemo(() => {
    return data.fpapFamilies
      .filter((f) => agency === 'all' || f.agency_id === agency)
      .filter((f) => !q || f.name.toLowerCase().includes(q.toLowerCase()))
      .map((f) => {
        const v = f.years[year]?.amount || 0;
        const total = YEARS.reduce((s, y) => s + (f.years[y]?.amount || 0), 0);
        return { f, v, total };
      })
      // Sort by the active year's amount descending; fall back to 7-year total
      // so programs that don't appear in the selected year still rank stably.
      .sort((a, b) => b.v - a.v || b.total - a.total);
  }, [data, year, q, agency]);

  return (
    <div>
      <YearStrip data={data} year={year} setYear={setYear} />

      <div
        className="flex between items-center"
        style={{ marginBottom: 14, marginTop: 28, gap: 16 }}
      >
        <Eyebrow>Programs · merged across renames · 7-year view</Eyebrow>
        <select
          value={agency}
          onChange={(e) => setAgency(e.target.value)}
          style={{
            border: '1px solid var(--ink)',
            padding: '7px 10px',
            fontFamily: 'var(--font-mono)',
            fontSize: 12,
            background: 'var(--paper)',
            color: 'var(--ink)',
          }}
        >
          <option value="all">All bureaus</option>
          {data.agencies.map((a) => (
            <option key={a.id} value={a.id}>
              {a.description}
            </option>
          ))}
        </select>
      </div>

      <input
        className="search-box"
        placeholder="Search programs (e.g. Internet, Cybersecurity, Smart City)…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />

      <table className="hier-table" style={{ marginTop: 18 }}>
        <thead>
          <tr>
            <th>PROGRAM</th>
            <th>BUREAU</th>
            <th className="right">FY {year}</th>
            <th className="right">7-YEAR TOTAL</th>
            <th>2020 — 2026</th>
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 60).map((r) => (
            <tr key={r.f.key} className="disabled">
              <td className="name">
                <span>{r.f.name}</span>
                {r.f.ids.length > 1 && (
                  <span className="desc">{r.f.ids.length} program codes (renames)</span>
                )}
              </td>
              <td style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-3)' }}>
                {(data.agencyById[r.f.agency_id]?.description || '')
                  .replace('National Telecommunications Commission', 'NTC')
                  .replace('National Privacy Commission', 'NPC')
                  .replace('Cybercrime Investigation and Coordination Center', 'CICC')
                  .replace('Office of the Secretary', 'OSEC')}
              </td>
              <td className="num">{fmt.php(r.v, { unit: r.v >= 1e9 ? 'B' : 'M' })}</td>
              <td className="num">{fmt.php(r.total, { unit: 'B' })}</td>
              <td className="spark-cell">
                <Spark
                  values={YEARS.map((y) => r.f.years[y]?.amount || 0)}
                  w={120}
                  h={22}
                  color="var(--accent-deep)"
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {rows.length > 60 && (
        <p style={{ marginTop: 12, fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-3)' }}>
          Showing top 60 of {rows.length}. Refine your search to see more.
        </p>
      )}
    </div>
  );
}

/* ---------- Methodology view ---------- */
function MethodologyView({ data }: { data: DeptData }) {
  return (
    <div style={{ maxWidth: 760, fontSize: 14.5, lineHeight: 1.7 }}>
      <SectionHead
        eyebrow="Methodology"
        headline="What this view does — and what it carefully avoids"
      />

      <h3 style={{ fontFamily: 'var(--font-hero)', fontSize: 17, marginTop: 22, marginBottom: 8 }}>Source</h3>
      <p style={{ color: 'var(--ink-2)' }}>
        Every figure on this view is parsed directly from the Philippines’{' '}
        <strong>General Appropriations Act</strong> for fiscal years 2020 through 2026, restricted to{' '}
        <strong>Department {data.department.id} — {data.department.description}</strong>. The GAA is the budget law
        passed by Congress; it does not measure obligations or disbursements, only the legal authority to spend.
        See the global <a href="/methodology" style={{ color: 'var(--accent)' }}>Methodology</a> page for the
        full set of caveats that apply across all 40 departments.
      </p>

      <h3 style={{ fontFamily: 'var(--font-hero)', fontSize: 17, marginTop: 22, marginBottom: 8 }}>Units</h3>
      <p style={{ color: 'var(--ink-2)' }}>
        The source data is denominated in <strong>thousands of pesos</strong>. We multiply by 1,000 at load time
        so every number you see on this site is in <strong>full pesos</strong>; the formatter then renders ₱B /
        ₱M / ₱K for legibility. A figure shown as “₱18.2B” means ₱18.2 billion, not ₱18.2 trillion.
      </p>

      <h3 style={{ fontFamily: 'var(--font-hero)', fontSize: 17, marginTop: 22, marginBottom: 8 }}>
        The hierarchy, and why drill-down stops at expense class
      </h3>
      <p style={{ color: 'var(--ink-2)' }}>
        Every appropriation line lives in a strict 7-level tree: Department → Agency → Program (FPAP) →
        Operating Unit → Fund → Expense Class → Object. The first six levels are stable enough to compare across
        years. The seventh — <strong>Object</strong> — is governed by the Unified Account Code Structure (UACS)
        catalog, which the DBM revised mid-period; identical line items appear under different codes in
        different years. We expose object-level values inside a single year only.
      </p>

      <h3 style={{ fontFamily: 'var(--font-hero)', fontSize: 17, marginTop: 22, marginBottom: 8 }}>Program renames</h3>
      <p style={{ color: 'var(--ink-2)' }}>
        At least a dozen significant programs were renamed or restructured across the 7 years. A naive chart
        shows them flatlining at ₱0 then jumping to ₱5B the next year — visually misleading. The{' '}
        <strong>Programs</strong> tab merges programs by <em>normalised name within bureau</em>, producing a
        continuous series wherever rename was clean. Renames that also moved between bureaus, or split a program
        in two, remain split.
      </p>

      <h3 style={{ fontFamily: 'var(--font-hero)', fontSize: 17, marginTop: 22, marginBottom: 8 }}>Aggregation</h3>
      <p style={{ color: 'var(--ink-2)' }}>
        Roll-ups (Department total, Agency totals, etc.) are recomputed from line items. The published totals
        from the GAA agree to within rounding — small residuals exist because the GAA introduces sub-totals at
        multiple levels (e.g. tax expenditure subsidies) which we deduplicate.
      </p>

      <h3 style={{ fontFamily: 'var(--font-hero)', fontSize: 17, marginTop: 22, marginBottom: 8 }}>
        What “count” means
      </h3>
      <p style={{ color: 'var(--ink-2)' }}>
        “Count” throughout this portal refers to <strong>budget line items</strong>, not projects or contracts.
        A single program can have hundreds of line items because it’s split across object codes, funds, and
        operating units.
      </p>
    </div>
  );
}

/* ---------- By year view ---------- */
function ByYearView({
  data,
  year,
  setYear,
}: {
  data: DeptData;
  year: number;
  setYear: (y: number) => void;
}) {
  const items = data.agencies
    .map((a) => ({ a, v: a.years[year]?.amount || 0 }))
    .sort((x, z) => z.v - x.v);
  const max = Math.max(...items.map((i) => i.v));

  return (
    <div>
      <YearStrip data={data} year={year} setYear={setYear} />

      <div style={{ marginBottom: 14, marginTop: 28 }}>
        <Eyebrow>FY {year} · the budget at a single moment</Eyebrow>
      </div>

      <div className="grid grid-2" style={{ marginBottom: 28 }}>
        <div className="card">
          <div className="card-head">
            <h3 className="card-title">By bureau</h3>
            <span className="card-meta">{fmt.php(data.total(year), { unit: 'B' })}</span>
          </div>
          <table className="hier-table">
            <tbody>
              {items.map(({ a, v }) => (
                <tr key={a.id} className="disabled">
                  <td className="name" style={{ maxWidth: 220 }}>
                    {a.description}
                  </td>
                  <td className="bar-cell">
                    <div className="bar-h accent">
                      <span style={{ width: `${(v / max) * 100}%` }}></span>
                    </div>
                  </td>
                  <td className="num">{fmt.php(v, { unit: v >= 1e9 ? 'B' : 'M' })}</td>
                  <td className="num delta">{fmt.pct(v / data.total(year), 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="card">
          <div className="card-head">
            <h3 className="card-title">By expense class</h3>
            <span className="card-meta">FY {year}</span>
          </div>
          <ExpenseClassStack data={data} year={year} />
          <p
            style={{
              marginTop: 16,
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
              color: 'var(--ink-3)',
              lineHeight: 1.6,
            }}
          >
            <strong style={{ color: 'var(--ink)' }}>PS</strong>: salaries and benefits.{' '}
            <strong style={{ color: 'var(--ink)' }}>MOOE</strong>: internet subscriptions, training, contract
            services.&nbsp;
            <strong style={{ color: 'var(--ink)' }}>CO</strong>: hardware, network builds, IT infrastructure.{' '}
            <strong style={{ color: 'var(--ink)' }}>FE</strong>: loan-related interest and charges.
          </p>
        </div>
      </div>

      <SectionHead
        eyebrow={`The FY ${year} treemap`}
        headline={`Where the ₱${fmt.shortPhp(data.total(year), 'B').replace('B', '')}B goes — every program at scale`}
        dek={`Each rectangle is a program (FPAP) — area is proportional to FY ${year} appropriation. Hover for exact figures. Color = bureau.`}
      />
      <Treemap data={data} year={year} height={520} />

      <div className="grid grid-2" style={{ marginTop: 28 }}>
        <div className="card">
          <div className="card-head">
            <h3 className="card-title">
              Biggest jumps · {year - 1} → {year}
            </h3>
          </div>
          <table className="hier-table">
            <tbody>
              {data.topMovers('up', year, year - 1, 6).map(({ fam, delta }: MoverEntry) => (
                <tr key={fam.key} className="disabled">
                  <td className="name">{fam.name}</td>
                  <td className="num" style={{ color: 'var(--positive)' }}>
                    +{fmt.php(delta, { unit: delta >= 1e9 ? 'B' : 'M' })}
                  </td>
                  <td className="spark-cell">
                    <Spark
                      values={YEARS.map((y) => fam.years[y]?.amount || 0)}
                      w={88}
                      h={22}
                      color="var(--positive)"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="card">
          <div className="card-head">
            <h3 className="card-title">
              Biggest cuts · {year - 1} → {year}
            </h3>
          </div>
          <table className="hier-table">
            <tbody>
              {data.topMovers('down', year, year - 1, 6).map(({ fam, delta }: MoverEntry) => (
                <tr key={fam.key} className="disabled">
                  <td className="name">{fam.name}</td>
                  <td className="num" style={{ color: 'var(--negative)' }}>
                    {fmt.php(delta, { unit: Math.abs(delta) >= 1e9 ? 'B' : 'M' })}
                  </td>
                  <td className="spark-cell">
                    <Spark
                      values={YEARS.map((y) => fam.years[y]?.amount || 0)}
                      w={88}
                      h={22}
                      color="var(--negative)"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ---------- Object Detail ---------- */
function ObjectDetail({
  obj,
  fpap,
  opUnit,
  fund,
  expense,
  agency,
  dept,
}: {
  obj: ObjectItem;
  fpap?: FPAP;
  opUnit?: { description: string };
  fund?: { description: string };
  expense?: { description: string };
  agency?: { description: string };
  dept: { id: string; description: string };
}) {
  const yearsPresent = YEARS.filter((y) => obj.years[y] && obj.years[y].amount);
  const maxAmt = yearsPresent.length > 0 ? Math.max(...yearsPresent.map((y) => obj.years[y].amount)) : 0;

  return (
    <div className="object-detail-inner">
      <div className="breadcrumb">
        <span className="bc-label">Where this lives</span>
        <ol>
          <li>
            <span className="bc-tier">Department</span>
            <span className="bc-name">{dept.description} ({dept.id})</span>
          </li>
          <li>
            <span className="bc-tier">Bureau</span>
            <span className="bc-name">{agency?.description || '—'}</span>
          </li>
          <li>
            <span className="bc-tier">Program</span>
            <span className="bc-name">{fpap?.description || '—'}</span>
          </li>
          <li>
            <span className="bc-tier">Operating Unit</span>
            <span className="bc-name">{opUnit?.description || '—'}</span>
          </li>
          <li>
            <span className="bc-tier">Fund</span>
            <span className="bc-name">{fund?.description || '—'}</span>
          </li>
          <li>
            <span className="bc-tier">Expense Class</span>
            <span className="bc-name">{expense?.description || '—'}</span>
          </li>
          <li>
            <span className="bc-tier">Object</span>
            <span className="bc-name strong">{obj.description}</span>
          </li>
        </ol>
      </div>

      <div className="bc-yearchart">
        <p className="bc-label">By year (this exact UACS code)</p>
        <table className="bc-yeartable">
          <tbody>
            {YEARS.map((y) => {
              const amt = obj.years[y]?.amount || 0;
              const p = maxAmt > 0 ? (amt / maxAmt) * 100 : 0;
              return (
                <tr key={y} className={amt ? '' : 'missing'}>
                  <td className="yc-year mono">{y}</td>
                  <td className="yc-bar">
                    <span style={{ width: `${p}%` }}></span>
                  </td>
                  <td className="yc-amt num">
                    {amt ? (
                      fmt.php(amt, { unit: amt >= 1e9 ? 'B' : amt >= 1e6 ? 'M' : 'K' })
                    ) : (
                      <span className="missing-label">not in GAA</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="bc-uacs">
          <span>UACS code</span> <code>{obj.object_code}</code>
        </p>
      </div>
    </div>
  );
}

/* ---------- Objects view ---------- */
const ROWS_PER_PAGE = 50;

function ObjectsView({
  data,
  year,
  setYear,
}: {
  data: DeptData;
  year: number;
  setYear: (y: number) => void;
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [q, setQ] = useState(() => searchParams.get('q') || '');
  const [bureau, setBureau] = useState(() => searchParams.get('bureau') || 'all');
  const [expense, setExpense] = useState(() => searchParams.get('expense') || 'all');
  const [sortKey, setSortKey] = useState<'amount' | 'description' | 'code'>('amount');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(0);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    const next = new URLSearchParams();
    if (q) next.set('q', q);
    if (bureau !== 'all') next.set('bureau', bureau);
    if (expense !== 'all') next.set('expense', expense);
    setSearchParams(next, { replace: true });
  }, [q, bureau, expense, setSearchParams]);

  const fpapById = useMemo(() => Object.fromEntries(data.fpaps.map((f) => [f.id, f])), [data]);
  const opUnitById = data.opUnitById;
  const fundById = data.fundById;
  const expenseById = useMemo(() => Object.fromEntries(data.expenses.map((e) => [e.id, e])), [data]);
  const agencyById = useMemo(() => Object.fromEntries(data.agencies.map((a) => [a.id, a])), [data]);

  const expenseClasses = useMemo(() => {
    const set = new Map<string, string>();
    data.expenses.forEach((e) => {
      const code = e.id.split('-').pop();
      if (!code || code === 'nan') return;
      const label = e.description || code;
      if (!set.has(code)) set.set(code, label);
    });
    return Array.from(set.entries()).map(([code, label]) => ({ code, label }));
  }, [data]);

  const rows = useMemo(() => {
    const ql = q.trim().toLowerCase();
    let list = data.objects.filter((o) => {
      if (!o.description || o.description === 'nan') return false;
      if (!o.years[year] || !o.years[year].amount) return false;
      if (bureau !== 'all' && o.agency_id !== bureau) return false;
      if (expense !== 'all') {
        const code = (o.expense_id || '').split('-').pop();
        if (code !== expense) return false;
      }
      if (ql) {
        const hay = `${o.description} ${o.object_code} ${o.slug || ''}`.toLowerCase();
        if (!hay.includes(ql)) return false;
      }
      return true;
    });
    list = list.slice().sort((a, b) => {
      const av =
        sortKey === 'amount'
          ? a.years[year]?.amount || 0
          : sortKey === 'code'
            ? a.object_code || ''
            : a.description || '';
      const bv =
        sortKey === 'amount'
          ? b.years[year]?.amount || 0
          : sortKey === 'code'
            ? b.object_code || ''
            : b.description || '';
      const cmp = typeof av === 'number' ? av - (bv as number) : String(av).localeCompare(String(bv));
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return list;
  }, [data, year, q, bureau, expense, sortKey, sortDir]);

  useEffect(() => {
    setPage(0);
    setOpenId(null);
  }, [q, bureau, expense, year, sortKey, sortDir]);

  const totalRows = rows.length;
  const pageCount = Math.max(1, Math.ceil(totalRows / ROWS_PER_PAGE));
  const pageRows = rows.slice(page * ROWS_PER_PAGE, (page + 1) * ROWS_PER_PAGE);
  const filteredTotal = rows.reduce((s, r) => s + (r.years[year]?.amount || 0), 0);

  function setSort(key: 'amount' | 'description' | 'code') {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(key);
      setSortDir(key === 'amount' ? 'desc' : 'asc');
    }
  }
  const arrow = (k: 'amount' | 'description' | 'code') =>
    sortKey === k ? (sortDir === 'asc' ? ' ↑' : ' ↓') : '';

  return (
    <div className="objects-view">
      <YearStrip data={data} year={year} setYear={setYear} />

      <div style={{ marginTop: 28 }}>
        <SectionHead
          eyebrow={`Objects · all ${data.objects
            .filter((o) => o.description !== 'nan')
            .length.toLocaleString()} UACS line items · FY ${year}`}
          headline="Every line item, searchable"
          dek="The lowest level of the budget hierarchy: each row is a single object code in a single fund, in a single operating unit, under a single program. This is the data your auditor reads. Search by name (e.g. “internet”), filter by bureau or expense class, click a row for the full breadcrumb."
        />
      </div>

      <div className="objects-toolbar">
        <div className="objects-search">
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search 4,868 line items — try “internet”, “salary”, “travelling”…"
          />
        </div>
        <div className="objects-filters">
          <label className="filter">
            <span>Bureau</span>
            <select value={bureau} onChange={(e) => setBureau(e.target.value)}>
              <option value="all">All bureaus</option>
              {data.agencies.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.description}
                </option>
              ))}
            </select>
          </label>
          <label className="filter">
            <span>Expense class</span>
            <select value={expense} onChange={(e) => setExpense(e.target.value)}>
              <option value="all">All classes</option>
              {expenseClasses.map(({ code, label }) => (
                <option key={code} value={code}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className="objects-summary">
        <span>
          <strong>{totalRows.toLocaleString()}</strong> line items match
        </span>
        <span className="sep">·</span>
        <span>
          Total: <strong>{fmt.php(filteredTotal, { unit: filteredTotal >= 1e9 ? 'B' : 'M' })}</strong>
        </span>
        <span className="sep">·</span>
        <span>
          {((filteredTotal / data.total(year)) * 100).toFixed(1)}% of FY {year} budget
        </span>
        <span className="objects-summary-spacer" />
        <DownloadCsvButton
          data={data}
          filter={{
            agencyId: bureau !== 'all' ? bureau : undefined,
            expenseClassCode: expense !== 'all' ? expense : undefined,
            year,
            query: q,
          }}
          filename={`gaa-${data.department.id}-objects-fy${year}${bureau !== 'all' ? '-' + bureau : ''}${expense !== 'all' ? '-class' + expense : ''}${q ? '-q' : ''}.csv`}
          variant="pill"
        />
      </div>

      <div className="objects-table-wrap">
        <table className="objects-table">
          <thead>
            <tr>
              <th className="col-code" onClick={() => setSort('code')}>
                UACS{arrow('code')}
              </th>
              <th className="col-name" onClick={() => setSort('description')}>
                Object{arrow('description')}
              </th>
              <th className="col-meta">Bureau · Class</th>
              <th className="col-amount" onClick={() => setSort('amount')}>
                FY {year}
                {arrow('amount')}
              </th>
            </tr>
          </thead>
          <tbody>
            {pageRows.map((o) => {
              const open = openId === o.id;
              const amt = o.years[year]?.amount || 0;
              const ag = agencyById[o.agency_id];
              const exp = expenseById[o.expense_id];
              const expCode = (o.expense_id || '').split('-').pop() || '';
              const expClass =
                ({ '1': 'PS', '2': 'MOOE', '3': 'CO', '4': 'FE', '5': 'FE' } as Record<string, string>)[expCode] || expCode;
              return (
                <Fragment key={o.id}>
                  <tr className={`obj-row ${open ? 'open' : ''}`} onClick={() => setOpenId(open ? null : o.id)}>
                    <td className="col-code mono">{o.object_code}</td>
                    <td className="col-name">{o.description}</td>
                    <td className="col-meta">
                      <span className="bureau-pill">
                        {ag?.description?.replace(
                          /Office of the |National |Cybercrime Investigation and Coordinating /,
                          '',
                        ) || '—'}
                      </span>
                      <span className="expense-pill" data-class={expClass}>
                        {expClass}
                      </span>
                    </td>
                    <td className="col-amount num">
                      {fmt.php(amt, { unit: amt >= 1e9 ? 'B' : amt >= 1e6 ? 'M' : 'K' })}
                    </td>
                  </tr>
                  {open && (
                    <tr className="obj-detail">
                      <td colSpan={4}>
                        <ObjectDetail
                          obj={o}
                          fpap={fpapById[o.fpap_id]}
                          opUnit={opUnitById[o.operating_unit_id]}
                          fund={fundById[o.fund_id]}
                          expense={exp}
                          agency={ag}
                          dept={data.department}
                        />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {pageRows.length === 0 && (
              <tr>
                <td colSpan={4} className="no-results">
                  No line items match these filters in FY {year}.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {pageCount > 1 && (
        <div className="objects-pager">
          <button disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>
            ← Prev
          </button>
          <span>
            Page <strong>{page + 1}</strong> of {pageCount} · showing {page * ROWS_PER_PAGE + 1}–
            {Math.min((page + 1) * ROWS_PER_PAGE, totalRows)} of {totalRows.toLocaleString()}
          </span>
          <button disabled={page >= pageCount - 1} onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}>
            Next →
          </button>
        </div>
      )}

      <p className="note-block" style={{ marginTop: 28 }}>
        <strong>On UACS object codes.</strong> The Department of Budget and Management revised the Unified
        Account Code Structure during this period. The same expense (e.g. “Internet Subscription Expenses”) may
        carry different codes across years, and some codes were merged or split. We therefore show one year at a
        time and avoid drawing multi-year lines at this level. To track an item across years, use the Programs
        tab instead, which merges renames at the program level.
      </p>
    </div>
  );
}

/* ---------- Raw data browser ---------- */
const RAW_ROWS_PER_PAGE = 50;
const DEFAULT_HIDDEN_COLS = new Set([
  'department_id',
  'department',
  'fpap_id',
  'operating_unit_id',
  'fund_id',
  'expense_id',
  'object_id',
]);

function formatCell(col: ColumnDef, val: RawCell): string {
  if (val == null || val === '') return '';
  if (col.numeric && typeof val === 'number') {
    if (col.group === 'year-amount' || col.key === 'total_amount_php') {
      if (val === 0) return '';
      return val.toLocaleString('en-US', { maximumFractionDigits: 0 });
    }
    if (val === 0) return '';
    return val.toLocaleString('en-US');
  }
  return String(val);
}

function DataBrowserView({ data }: { data: DeptData }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [q, setQ] = useState(() => searchParams.get('q') || '');
  const [bureau, setBureau] = useState(() => searchParams.get('bureau') || 'all');
  const [expense, setExpense] = useState(() => searchParams.get('expense') || 'all');
  const [sortKey, setSortKey] = useState<string>('total_amount_php');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(0);
  const [hidden, setHidden] = useState<Set<string>>(new Set(DEFAULT_HIDDEN_COLS));
  const [colsOpen, setColsOpen] = useState(false);

  useEffect(() => {
    const next = new URLSearchParams();
    if (q) next.set('q', q);
    if (bureau !== 'all') next.set('bureau', bureau);
    if (expense !== 'all') next.set('expense', expense);
    setSearchParams(next, { replace: true });
  }, [q, bureau, expense, setSearchParams]);

  const columns = useMemo(() => buildColumns(YEARS), []);

  const expenseClasses = useMemo(() => {
    const set = new Map<string, string>();
    data.expenses.forEach((e) => {
      const code = e.id.split('-').pop();
      if (!code || code === 'nan') return;
      const label = e.description || code;
      if (!set.has(code)) set.set(code, label);
    });
    return Array.from(set.entries()).map(([code, label]) => ({ code, label }));
  }, [data]);

  const allRows = useMemo(() => {
    return data.objects
      .filter((o) => o.description && o.description !== 'nan')
      .map((o) => buildRow(data, o, YEARS));
  }, [data]);

  const filtered = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return allRows.filter((r) => {
      if (bureau !== 'all' && r.agency_id !== bureau) return false;
      if (expense !== 'all' && r.expense_class_code !== expense) return false;
      if (ql) {
        // Search across all visible string-ish columns.
        for (const c of columns) {
          if (c.numeric) continue;
          const v = r[c.key];
          if (v && String(v).toLowerCase().includes(ql)) return true;
        }
        return false;
      }
      return true;
    });
  }, [allRows, q, bureau, expense, columns]);

  const sorted = useMemo(() => {
    const list = filtered.slice();
    list.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      let cmp: number;
      if (typeof av === 'number' && typeof bv === 'number') cmp = av - bv;
      else cmp = String(av ?? '').localeCompare(String(bv ?? ''));
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return list;
  }, [filtered, sortKey, sortDir]);

  useEffect(() => {
    setPage(0);
  }, [q, bureau, expense, sortKey, sortDir]);

  const totalRows = sorted.length;
  const pageCount = Math.max(1, Math.ceil(totalRows / RAW_ROWS_PER_PAGE));
  const pageRows = sorted.slice(page * RAW_ROWS_PER_PAGE, (page + 1) * RAW_ROWS_PER_PAGE);
  const visibleCols = columns.filter((c) => !hidden.has(c.key));

  function toggleSort(key: string, numeric: boolean) {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(key);
      setSortDir(numeric ? 'desc' : 'asc');
    }
  }
  const arrow = (k: string) => (sortKey === k ? (sortDir === 'asc' ? ' ↑' : ' ↓') : '');

  function downloadFiltered() {
    const objects = data.objects.filter((o) => {
      if (!o.description || o.description === 'nan') return false;
      if (bureau !== 'all' && o.agency_id !== bureau) return false;
      if (expense !== 'all') {
        const code = (o.expense_id || '').split('-').pop();
        if (code !== expense) return false;
      }
      const ql = q.trim().toLowerCase();
      if (ql) {
        const r = buildRow(data, o, YEARS);
        let hit = false;
        for (const c of columns) {
          if (c.numeric) continue;
          const v = r[c.key];
          if (v && String(v).toLowerCase().includes(ql)) {
            hit = true;
            break;
          }
        }
        if (!hit) return false;
      }
      return true;
    });
    const csv = objectsToCsv(data, objects, YEARS);
    const fn = `gaa-${data.department.id}-data${bureau !== 'all' ? '-' + bureau : ''}${expense !== 'all' ? '-class' + expense : ''}${q ? '-q' : ''}.csv`;
    downloadCsv(fn, csv);
  }

  function toggleCol(key: string) {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <div className="raw-browser">
      <SectionHead
        eyebrow={`Raw dataset · ${allRows.length.toLocaleString()} line items × ${columns.length} columns`}
        headline="Raw data browser"
        dek="The same flat table the CSV download produces — every UACS line item denormalised with its full department → agency → program → operating unit → fund → expense-class breadcrumb, plus seven years of amount + count columns. Search, filter, sort, paginate. Hidden ID columns can be toggled on for joins."
      />

      <div className="raw-toolbar">
        <input
          type="search"
          className="raw-search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search any column — try “internet”, “salary”, “OSEC”, a UACS code…"
        />
        <div className="raw-filters">
          <label className="filter">
            <span>Bureau</span>
            <select value={bureau} onChange={(e) => setBureau(e.target.value)}>
              <option value="all">All bureaus</option>
              {data.agencies.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.description}
                </option>
              ))}
            </select>
          </label>
          <label className="filter">
            <span>Expense class</span>
            <select value={expense} onChange={(e) => setExpense(e.target.value)}>
              <option value="all">All classes</option>
              {expenseClasses.map(({ code, label }) => (
                <option key={code} value={code}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="raw-cols-btn"
            aria-expanded={colsOpen}
            onClick={() => setColsOpen((o) => !o)}
          >
            Columns · {visibleCols.length}/{columns.length}
          </button>
        </div>
      </div>

      {colsOpen && (
        <div className="raw-cols-panel">
          <div className="raw-cols-grid">
            {columns.map((c) => (
              <label key={c.key} className="raw-col-toggle">
                <input
                  type="checkbox"
                  checked={!hidden.has(c.key)}
                  onChange={() => toggleCol(c.key)}
                />
                <code>{c.key}</code>
              </label>
            ))}
          </div>
          <div className="raw-cols-actions">
            <button type="button" onClick={() => setHidden(new Set())}>
              Show all
            </button>
            <button type="button" onClick={() => setHidden(new Set(DEFAULT_HIDDEN_COLS))}>
              Reset
            </button>
            <button type="button" onClick={() => setHidden(new Set(columns.map((c) => c.key)))}>
              Hide all
            </button>
          </div>
        </div>
      )}

      <div className="raw-summary">
        <span>
          <strong>{totalRows.toLocaleString()}</strong> rows match
        </span>
        <span className="sep">·</span>
        <span>
          page <strong>{page + 1}</strong> of {pageCount}
        </span>
        <span className="raw-summary-spacer" />
        <button
          type="button"
          className="csv-btn csv-btn-pill"
          disabled={totalRows === 0}
          onClick={downloadFiltered}
        >
          <span className="csv-btn-arrow">↓</span>
          <span>Download CSV · {totalRows.toLocaleString()} rows</span>
        </button>
      </div>

      <div className="raw-table-wrap">
        <table className="raw-table">
          <thead>
            <tr>
              {visibleCols.map((c) => (
                <th
                  key={c.key}
                  className={`raw-th raw-th-${c.group} ${c.numeric ? 'num' : ''}`}
                  style={{ width: c.width, minWidth: c.width }}
                  onClick={() => toggleSort(c.key, c.numeric)}
                  title={`${c.key} (click to sort)`}
                >
                  {c.label}
                  {arrow(c.key)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pageRows.map((r) => (
              <tr key={String(r.object_id)}>
                {visibleCols.map((c) => (
                  <td
                    key={c.key}
                    className={`raw-td raw-td-${c.group} ${c.numeric ? 'num' : ''}`}
                    title={String(r[c.key] ?? '')}
                  >
                    {formatCell(c, r[c.key])}
                  </td>
                ))}
              </tr>
            ))}
            {pageRows.length === 0 && (
              <tr>
                <td className="no-results" colSpan={visibleCols.length}>
                  No rows match these filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {pageCount > 1 && (
        <div className="objects-pager">
          <button disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>
            ← Prev
          </button>
          <span>
            Page <strong>{page + 1}</strong> of {pageCount} · showing{' '}
            {totalRows === 0 ? 0 : page * RAW_ROWS_PER_PAGE + 1}–
            {Math.min((page + 1) * RAW_ROWS_PER_PAGE, totalRows)} of {totalRows.toLocaleString()}
          </span>
          <button
            disabled={page >= pageCount - 1}
            onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
}

/* ---------- Lazy-load affordances for heavy stages ---------- */
type StageState = 'idle' | 'loading' | 'loaded' | 'error';

/** Ticks elapsed seconds while mounted. Used inside loading-state UI to
 *  give users a visible sign that work is happening on long parquet queries. */
function Elapsed() {
  const [secs, setSecs] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setSecs((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, []);
  return <>{secs}s elapsed</>;
}

function StageLoader({
  stage,
  state,
  error,
  deptId,
  onLoad,
}: {
  stage: 'mid' | 'objects';
  state: StageState;
  error: string | null;
  deptId: string;
  onLoad?: () => void;
}) {
  const sizeHint = stage === 'mid' ? midSizeHintMb(deptId) : objectsSizeHintMb(deptId);
  const stageLabel =
    stage === 'mid' ? 'programs, bureaus, funds & expense classes' : 'line-item appropriations';
  const stageTechnical =
    stage === 'mid'
      ? 'fpaps + operating_units + fund_subcategories + expenses'
      : 'objects (UACS line items)';
  const heavyHint =
    stage === 'objects' &&
    'Large groups can return hundreds of thousands of rows — the query runs entirely in your browser via DuckDB-WASM.';

  if (state === 'idle' && onLoad) {
    return (
      <div className="stage-loader stage-loader-idle">
        <p>
          This group’s {stageLabel} aren’t loaded automatically
          {sizeHint != null && ` (~${sizeHint} MB on the wire)`}.
        </p>
        <p className="stage-loader-tech">
          <code>{stageTechnical}</code>
        </p>
        <button
          type="button"
          className="csv-btn csv-btn-pill"
          onClick={onLoad}
          style={{ display: 'inline-flex' }}
        >
          <span className="csv-btn-arrow">↓</span>
          <span>Load this data</span>
        </button>
      </div>
    );
  }

  if (state === 'error') {
    return (
      <div className="stage-loader stage-loader-error">
        <p>Could not load {stageLabel} for group {deptId}.</p>
        <p className="stage-loader-detail">{error}</p>
      </div>
    );
  }

  // state === 'loading' (or 'loaded' transition — both fall through to the
  // progress UI; the parent unmounts us once the data is in hand).
  return (
    <div className="stage-loader stage-loader-loading">
      <p className="stage-loader-title">
        Querying {stageLabel}…
      </p>
      <div className="loading-bar" aria-hidden="true" />
      <p className="stage-loader-detail">
        Range-reading parquet from the CDN, then aggregating in your browser.
        {sizeHint != null && ` ~${sizeHint} MB worst-case payload.`}
      </p>
      <p className="stage-loader-elapsed" aria-live="polite">
        <Elapsed />
      </p>
      {heavyHint && (
        <p className="stage-loader-hint">{heavyHint}</p>
      )}
    </div>
  );
}

/* ---------- Page shell ---------- */

export default function Portal() {
  const { deptId = '' } = useParams<{ deptId: string }>();
  const [data, setData] = useState<DeptData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [midState, setMidState] = useState<StageState>('idle');
  const [midError, setMidError] = useState<string | null>(null);
  const [objectsState, setObjectsState] = useState<StageState>('idle');
  const [objectsError, setObjectsError] = useState<string | null>(null);
  const [year, setYear] = useState(FALLBACK_YEAR);
  const location = useLocation();
  const navigate = useNavigate();
  const view: View = VIEW_BY_SUFFIX[pathSuffix(location.pathname, deptId)] || 'hierarchy';

  useEffect(() => {
    if (!deptId) return;
    setData(null);
    setLoadError(null);
    setMidState('idle');
    setMidError(null);
    setObjectsState('idle');
    setObjectsError(null);
    let cancelled = false;
    loadDeptData(deptId)
      .then((d) => { if (!cancelled) setData(d); })
      .catch((e) => { if (!cancelled) setLoadError(String(e?.message || e)); });
    return () => { cancelled = true; };
  }, [deptId]);

  const triggerMidLoad = () => {
    if (!data) return;
    if (midState !== 'idle') return;
    setMidState('loading');
    loadDeptMidInto(data, deptId)
      .then((next) => {
        setData(next);
        setMidState('loaded');
      })
      .catch((e) => {
        setMidError(String(e?.message || e));
        setMidState('error');
      });
  };

  // Auto-fire Stage B in the background as soon as Stage A lands — except
  // for outlier departments (e.g. DPWH) where the combined payload is so
  // large that the user must explicitly opt in.
  useEffect(() => {
    if (!data || data.midLoaded || midState !== 'idle') return;
    if (isMidHeavy(deptId)) return;
    triggerMidLoad();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, deptId, midState]);

  const triggerObjectsLoad = () => {
    if (!data || objectsState !== 'idle') return;
    setObjectsState('loading');
    loadDeptObjectsInto(data, deptId)
      .then((next) => {
        setData(next);
        setObjectsState('loaded');
      })
      .catch((e) => {
        setObjectsError(String(e?.message || e));
        setObjectsState('error');
      });
  };

  // Auto-fire objects load when user enters Objects or Data view, unless the
  // dept is in HEAVY_OBJECTS_DEPTS (DepEd, DPWH) — those have ~1M aggregated
  // rows which lock the React render thread on filter/sort even with
  // pagination. Heavy depts require an explicit click instead.
  useEffect(() => {
    if (!data) return;
    if (objectsState !== 'idle') return;
    if (view !== 'objects' && view !== 'data') return;
    if (isObjectsHeavy(deptId)) return;
    triggerObjectsLoad();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, data, deptId, objectsState]);

  if (loadError) {
    return (
      <div
        style={{
          padding: 80,
          textAlign: 'center',
          fontFamily: 'var(--font-mono)',
          color: 'var(--accent)',
        }}
      >
        <p>Could not load group <code>{deptId}</code>.</p>
        <p style={{ color: 'var(--ink-3)', fontSize: 12 }}>{loadError}</p>
        <p><Link to="/">← Back to national overview</Link></p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="page-shell-loader">
        <p className="page-shell-loader-title">Loading group {deptId}…</p>
        <div className="loading-bar" aria-hidden="true" />
        <p className="page-shell-loader-detail">FY 2020 – 2026 totals & bureaus</p>
        <p className="page-shell-loader-elapsed" aria-live="polite">
          <Elapsed />
        </p>
      </div>
    );
  }

  const sevenYearTotal = YEARS.reduce((s, y) => s + data.total(y), 0);
  const deptSlug = data.department.description
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  const csvFilename = `gaa-${deptId}-${deptSlug}-fy2020-2026.csv`;

  function go(v: View) {
    navigate(`/d/${deptId}${SUFFIX_BY_VIEW[v]}`);
  }

  const sectionTabs: Array<[View, string]> = [
    ['hierarchy', 'Overview'],
    ['byyear', 'By year'],
    ['programs', 'Programs'],
    ['objects', 'Objects'],
    ['data', 'Data'],
    ['methodology', 'Methodology'],
  ];

  return (
    <>
      <SiteHeader
        crumb={data.department.description}
        compiledMeta={
          <>
            <DownloadCsvButton
              data={data}
              filter={{}}
              filename={csvFilename}
              label="Download · CSV"
              variant="inline"
            />
            <span className="masthead-meta-sep">·</span>
            Compiled · ₱{fmt.shortPhp(sevenYearTotal, 'B').replace('₱', '')}
          </>
        }
        subNav={
          <nav className="view-tabs section-tabs" aria-label="Group sections">
            {sectionTabs.map(([v, label]) => (
              <button
                key={v}
                className={view === v ? 'active' : ''}
                onClick={() => go(v)}
              >
                {label}
              </button>
            ))}
          </nav>
        }
        drawerExtras={
          <>
            <span className="drawer-eyebrow">Group sections</span>
            {sectionTabs.map(([v, label]) => (
              <button
                key={v}
                type="button"
                className={`drawer-link ${view === v ? 'active' : ''}`}
                onClick={() => go(v)}
              >
                {label}
                <span className="drawer-link-arrow">→</span>
              </button>
            ))}
            <span className="drawer-eyebrow" style={{ marginTop: 16 }}>Dataset</span>
            <DownloadCsvButton
              data={data}
              filter={{}}
              filename={csvFilename}
              label="Download · CSV"
              variant="pill"
            />
            <p className="drawer-meta">
              Compiled · 7 fiscal years · ₱{fmt.shortPhp(sevenYearTotal, 'B').replace('₱', '')}
            </p>
          </>
        }
      />

      <main style={{ maxWidth: 1440, margin: '0 auto', padding: '32px 32px 80px' }}>
        <div className="page-headline">
          <p className="page-eyebrow">Department {deptId} · FY 2020 – 2026</p>
          <h1 className="page-title">{data.department.description}</h1>
        </div>
        {view !== 'methodology' && view !== 'data' && (
          <KpiStrip data={data} hideOnMobile={view !== 'hierarchy'} />
        )}
        {view === 'hierarchy' && <TrendChart data={data} />}

        {view === 'hierarchy' && (
          <HierarchyView
            data={data}
            year={year}
            setYear={setYear}
            midState={midState}
            midError={midError}
            onRequestMid={triggerMidLoad}
            deptId={deptId}
          />
        )}
        {view === 'byyear' && <ByYearView data={data} year={year} setYear={setYear} />}
        {view === 'programs' &&
          (data.midLoaded ? (
            <ProgramsView data={data} year={year} setYear={setYear} />
          ) : (
            <StageLoader
              stage="mid"
              state={midState}
              error={midError}
              deptId={deptId}
              onLoad={midState === 'idle' ? triggerMidLoad : undefined}
            />
          ))}
        {view === 'objects' &&
          (data.midLoaded && data.objectsLoaded ? (
            <ObjectsView data={data} year={year} setYear={setYear} />
          ) : !data.midLoaded ? (
            <StageLoader
              stage="mid"
              state={midState}
              error={midError}
              deptId={deptId}
              onLoad={midState === 'idle' ? triggerMidLoad : undefined}
            />
          ) : (
            <StageLoader
              stage="objects"
              state={objectsState}
              error={objectsError}
              deptId={deptId}
              onLoad={objectsState === 'idle' ? triggerObjectsLoad : undefined}
            />
          ))}
        {view === 'data' &&
          (data.midLoaded && data.objectsLoaded ? (
            <DataBrowserView data={data} />
          ) : !data.midLoaded ? (
            <StageLoader
              stage="mid"
              state={midState}
              error={midError}
              deptId={deptId}
              onLoad={midState === 'idle' ? triggerMidLoad : undefined}
            />
          ) : (
            <StageLoader
              stage="objects"
              state={objectsState}
              error={objectsError}
              deptId={deptId}
              onLoad={objectsState === 'idle' ? triggerObjectsLoad : undefined}
            />
          ))}
        {view === 'methodology' && <MethodologyView data={data} />}

        {view !== 'methodology' && view !== 'data' && (
          <p className="note-block">
            <strong>Note.</strong> All amounts are appropriations under the General Appropriations Act, in
            pesos. Source data is published in thousands; values shown here are converted to full pesos and
            rendered as ₱B / ₱M / ₱K for legibility. The GAA is the legal authority to spend — not actual
            obligations or disbursements. See the Methodology tab for caveats on object-level codes and program
            renames.
          </p>
        )}
      </main>

      <SiteFooter />
    </>
  );
}
