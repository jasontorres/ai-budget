import type {
  Agency,
  DeptData,
  Department,
  Expense,
  ExpenseClassBreakdown,
  ExpenseClassMeta,
  FPAP,
  FPAPFamily,
  Fund,
  MoverEntry,
  ObjectItem,
  OperatingUnit,
  RawDataset,
  YearData,
  YearMap,
  YearlyTotalRow,
} from './types';

export const YEARS: number[] = [2020, 2021, 2022, 2023, 2024, 2025, 2026];
const SCALE = 1000;

/**
 * Three-stage progressive load:
 *   A · core (always upfront)     — departments + yearly + agencies        (~50KB)
 *   B · mid  (auto unless heavy)  — fpaps + op_units + fund_sub + expenses
 *   C · objects (on demand)       — objects.json
 *
 * For most departments Stage B is small enough to fire in the background
 * right after Stage A lands, so the UI feels instant. For a small number of
 * outlier departments the Stage B JSONs are tens-to-hundreds of MB each;
 * we list them in `HEAVY_MID_DEPTS` so the UI requires explicit opt-in.
 */
const HEAVY_MID_DEPTS = new Set<string>(['18']); // DPWH: ~653MB combined
const SKIP_EXPENSES = new Set<string>(['18']);

const MID_SIZE_HINT_MB: Record<string, number> = {
  '18': 653,
};
const OBJECT_SIZE_HINT_MB: Record<string, number> = {
  '07': 650,
  '18': 224,
};

export function isMidHeavy(deptId: string): boolean {
  return HEAVY_MID_DEPTS.has(deptId);
}
export function midSizeHintMb(deptId: string): number | undefined {
  return MID_SIZE_HINT_MB[deptId];
}
export function objectsSizeHintMb(deptId: string): number | undefined {
  return OBJECT_SIZE_HINT_MB[deptId];
}

export const EXPENSE_CLASS: Record<string, ExpenseClassMeta> = {
  '1': { key: 'PS', label: 'Personnel Services', color: 'var(--ec-ps)' },
  '2': { key: 'MOOE', label: 'Maintenance & Operating', color: 'var(--ec-mooe)' },
  '3': { key: 'FE', label: 'Financial Expenses', color: 'var(--ec-fe)' },
  '4': { key: 'CO', label: 'Capital Outlays', color: 'var(--ec-co)' },
  '5': { key: 'CO', label: 'Capital Outlays', color: 'var(--ec-co)' },
};

export function normName(s: string): string {
  return (s || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[^a-z0-9 ]/g, '')
    .trim();
}

async function loadJson<T>(path: string): Promise<T> {
  const r = await fetch(path);
  if (!r.ok) throw new Error('Failed to load ' + path);
  return (await r.json()) as T;
}

function emptyYearMap(): YearMap {
  const m: YearMap = {};
  YEARS.forEach((y) => (m[y] = { count: 0, amount: 0 }));
  return m;
}

function rescale<T extends { years: YearMap }>(rec: T): T {
  const out: T = { ...rec, years: emptyYearMap() };
  YEARS.forEach((y) => {
    const src = rec.years as Record<string | number, YearData | undefined>;
    const s = src[y] || src[String(y)];
    if (s) {
      out.years[y].count = s.count || 0;
      out.years[y].amount = (s.amount || 0) * SCALE;
    }
  });
  return out;
}

function isNan(rec: { description?: string; slug?: string }): boolean {
  return (rec.description || '').toLowerCase() === 'nan' || (rec.slug || '') === 'nan';
}

export function totalOver(rec: { years: YearMap }, years: number[] = YEARS): number {
  return years.reduce((s, y) => s + (rec.years[y]?.amount || 0), 0);
}

export function maxOver(rec: { years: YearMap }, years: number[] = YEARS): number {
  return Math.max(...years.map((y) => rec.years[y]?.amount || 0));
}

function deptUrl(deptId: string, file: string): string {
  const base = (import.meta.env.BASE_URL || '/').replace(/\/$/, '');
  return `${base}/data/${deptId}/${file}`;
}

function emptyExpenseClassByYear(): Record<number, ExpenseClassBreakdown> {
  const out: Record<number, ExpenseClassBreakdown> = {};
  YEARS.forEach((y) => (out[y] = { PS: 0, MOOE: 0, CO: 0, FE: 0 }));
  return out;
}

/**
 * Stage A. Loads just enough to render the masthead, KPI strip, trend chart,
 * ByYear view, and the top level of the Hierarchy view. The remaining
 * arrays/maps come back empty and are populated by `loadDeptMidInto` and
 * `loadDeptObjectsInto`.
 */
export async function loadDeptData(deptId: string): Promise<DeptData> {
  const url = (p: string) => deptUrl(deptId, p);

  const [departments, yearly, agencies] = await Promise.all([
    loadJson<RawDataset<Department>>(url('departments.json')),
    loadJson<RawDataset<{ year: number; count: number; amount: number }>>(url('yearly_totals.json')),
    loadJson<RawDataset<Agency>>(url('agencies.json')),
  ]);

  const dept = departments.data[0];
  const deptTotal: Record<number, YearData> = {};
  yearly.data.forEach((r) => {
    deptTotal[r.year] = { count: r.count, amount: r.amount * SCALE };
  });

  const agencyArr: Agency[] = agencies.data.filter((a) => !isNan(a)).map(rescale);
  const agencyById: Record<string, Agency> = Object.fromEntries(agencyArr.map((a) => [a.id, a]));

  const yearlyOut: YearlyTotalRow[] = yearly.data.map((r) => ({
    year: r.year,
    count: r.count,
    amount: r.amount * SCALE,
  }));

  return {
    YEARS,
    EXPENSE_CLASS,

    department: {
      id: dept?.id ?? deptId,
      description: dept?.description ?? `Department ${deptId}`,
      years: deptTotal,
    },
    yearly: yearlyOut,

    agencies: agencyArr,
    agencyById,

    fpaps: [],
    fpapById: {},
    fpapsByAgency: {},
    fpapFamilies: [],

    opUnits: [],
    opUnitById: {},
    funds: [],
    fundById: {},
    objects: [],
    expenses: [],

    expenseClassByYear: emptyExpenseClassByYear(),
    expenseClassByAgencyYear: {},

    midLoaded: false,
    objectsLoaded: false,
    expensesSkipped: false,

    total: (y: number) => deptTotal[y]?.amount || 0,
    totalOver,
    maxOver,
    normName,
    topMovers: () => [],
  };
}

/**
 * Stage B. Fetches the program/op-unit/fund/expense JSONs, computes all
 * mid-level derivatives (fpapFamilies, fpapsByAgency, expense-class
 * breakdowns, topMovers), and returns a new DeptData with `midLoaded: true`.
 */
export async function loadDeptMidInto(data: DeptData, deptId: string): Promise<DeptData> {
  const url = (p: string) => deptUrl(deptId, p);
  const skipExpenses = SKIP_EXPENSES.has(deptId);

  const [fpapsRaw, opUnitsRaw, fundsRaw, expensesRaw] = await Promise.all([
    loadJson<RawDataset<FPAP>>(url('fpaps.json')),
    loadJson<RawDataset<OperatingUnit>>(url('operating_units.json')),
    loadJson<RawDataset<Fund>>(url('fund_subcategories.json')),
    skipExpenses
      ? Promise.resolve<RawDataset<Expense>>({ data: [] })
      : loadJson<RawDataset<Expense>>(url('expenses.json')),
  ]);

  const fpapArr: FPAP[] = fpapsRaw.data
    .filter((f) => !isNan(f))
    .map(rescale)
    .filter((f) => totalOver(f) > 0);
  const fpapById: Record<string, FPAP> = Object.fromEntries(fpapArr.map((f) => [f.id, f]));

  const fpapsByAgency: Record<string, FPAP[]> = {};
  fpapArr.forEach((f) => {
    (fpapsByAgency[f.agency_id] ||= []).push(f);
  });

  const fpapFamiliesArr: FPAPFamily[] = [];
  {
    const byKey: Record<string, FPAPFamily> = {};
    fpapsRaw.data
      .filter((f) => !isNan(f))
      .forEach((f) => {
        const key = f.agency_id + '|' + normName(f.description);
        if (!byKey[key]) {
          byKey[key] = {
            key,
            agency_id: f.agency_id,
            name: f.description,
            ids: [],
            years: emptyYearMap(),
          };
        }
        byKey[key].ids.push(f.id);
        YEARS.forEach((y) => {
          const src = f.years as Record<string | number, YearData | undefined>;
          const s = src[y] || src[String(y)];
          if (s) {
            byKey[key].years[y].count += s.count || 0;
            byKey[key].years[y].amount += (s.amount || 0) * SCALE;
          }
        });
      });
    Object.values(byKey).forEach((fam) => {
      if (totalOver(fam) > 0) fpapFamiliesArr.push(fam);
    });
  }

  const expenseArr: Expense[] = expensesRaw.data.filter((e) => !isNan(e)).map(rescale);

  const expenseClassByAgencyYear: Record<string, Record<number, ExpenseClassBreakdown>> = {};
  const expenseClassByYear = emptyExpenseClassByYear();

  expenseArr.forEach((e) => {
    const cls = EXPENSE_CLASS[e.expense_code]?.key;
    if (!cls) return;
    const a = e.agency_id;
    if (!expenseClassByAgencyYear[a]) {
      expenseClassByAgencyYear[a] = {};
      YEARS.forEach((y) => (expenseClassByAgencyYear[a][y] = { PS: 0, MOOE: 0, CO: 0, FE: 0 }));
    }
    YEARS.forEach((y) => {
      const v = e.years[y]?.amount || 0;
      expenseClassByAgencyYear[a][y][cls] += v;
      expenseClassByYear[y][cls] += v;
    });
  });

  const opUnitArr: OperatingUnit[] = opUnitsRaw.data.filter((o) => !isNan(o)).map(rescale);
  const opUnitById: Record<string, OperatingUnit> = Object.fromEntries(opUnitArr.map((o) => [o.id, o]));

  const fundArr: Fund[] = fundsRaw.data.filter((o) => !isNan(o)).map(rescale);
  const fundById: Record<string, Fund> = Object.fromEntries(fundArr.map((o) => [o.id, o]));

  function topMovers(
    direction: 'up' | 'down' = 'up',
    year = 2026,
    prev = 2025,
    n = 6,
  ): MoverEntry[] {
    const moves: MoverEntry[] = fpapFamiliesArr.map((fam) => ({
      fam,
      delta: (fam.years[year]?.amount || 0) - (fam.years[prev]?.amount || 0),
    }));
    moves.sort((a, b) => (direction === 'up' ? b.delta - a.delta : a.delta - b.delta));
    return moves.slice(0, n);
  }

  return {
    ...data,
    fpaps: fpapArr,
    fpapById,
    fpapsByAgency,
    fpapFamilies: fpapFamiliesArr,
    opUnits: opUnitArr,
    opUnitById,
    funds: fundArr,
    fundById,
    expenses: expenseArr,
    expenseClassByYear,
    expenseClassByAgencyYear,
    midLoaded: true,
    expensesSkipped: skipExpenses,
    topMovers,
  };
}

/**
 * Stage C. Fetches objects.json (the largest file) and returns a new DeptData
 * with `objects` populated. Called on-demand the first time the user enters
 * the Objects or Data view.
 */
export async function loadDeptObjectsInto(data: DeptData, deptId: string): Promise<DeptData> {
  const raw = await loadJson<RawDataset<ObjectItem>>(deptUrl(deptId, 'objects.json'));
  const objects: ObjectItem[] = raw.data.filter((o) => !isNan(o)).map(rescale);
  return { ...data, objects, objectsLoaded: true };
}
