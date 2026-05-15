import type { Agency, FPAP, RawDataset, YearMap } from './types';

export interface LevelDef {
  key: 'department' | 'agency' | 'fpap' | 'operunit' | 'fund' | 'expense' | 'object';
  file: string;
  labelSingular: string;
  labelPlural: string;
  parentKey: string | null;
  order: number;
}

export const LEVELS: LevelDef[] = [
  { key: 'department', file: 'departments.json', labelSingular: 'Department', labelPlural: 'Departments', parentKey: null, order: 1 },
  { key: 'agency', file: 'agencies.json', labelSingular: 'Agency', labelPlural: 'Agencies', parentKey: 'department_id', order: 2 },
  { key: 'fpap', file: 'fpaps.json', labelSingular: 'Program', labelPlural: 'Programs', parentKey: 'agency_id', order: 3 },
  { key: 'operunit', file: 'operating_units.json', labelSingular: 'Operating Unit', labelPlural: 'Operating Units', parentKey: 'fpap_id', order: 4 },
  { key: 'fund', file: 'fund_subcategories.json', labelSingular: 'Fund Source', labelPlural: 'Fund Sources', parentKey: 'operating_unit_id', order: 5 },
  { key: 'expense', file: 'expenses.json', labelSingular: 'Expense Class', labelPlural: 'Expense Classes', parentKey: 'fund_id', order: 6 },
  { key: 'object', file: 'objects.json', labelSingular: 'Line Item', labelPlural: 'Line Items', parentKey: 'expense_id', order: 7 },
];

export const AGENCY_META: Record<string, { short: string; tone: string; note: string }> = {
  '37-001': { short: 'OSEC', tone: 'neutral', note: '84% of 7-yr total' },
  '37-002': { short: 'NTC', tone: 'decline', note: '−81% over 7 years' },
  '37-003': { short: 'NPC', tone: 'small', note: 'Smallest of the four' },
  '37-004': { short: 'CICC', tone: 'growth', note: '+5,042% growth' },
};

export const RENAME_MAP = [
  { old: 'Free Internet Wi-Fi Connectivity in Public Places', successor: 'Free Public Internet Access Program' },
  { old: 'Free Internet Wi-Fi in State Universities and Colleges', successor: 'Free Public Internet Access Program' },
  { old: 'National Broadband Plan', successor: 'National Broadband Program' },
  { old: 'ICT Literacy Development and Management', successor: 'ICT Capacity Development and Management' },
  { old: 'ICT and Cybersecurity Policies', successor: 'Cybersecurity Information Infrastructure Dev & Mgmt' },
  { old: 'ICT Modernization Program', successor: '(split across multiple new FPAPs)' },
  { old: 'National Government Portal', successor: 'Digital Government Development and Management' },
  { old: 'ICT Systems and Infostructure', successor: 'Digital Information Infrastructure Dev & Mgmt' },
];

export function isLabelable(row: { description?: string } | undefined | null): boolean {
  return !!row && !!row.description && row.description !== 'nan' && row.description.trim().length > 0;
}

export function toPesos(amountThousands: number | null | undefined): number {
  if (amountThousands == null || !Number.isFinite(amountThousands)) return 0;
  return amountThousands * 1000;
}

export function yearAmounts(row: { years?: YearMap }): Record<number, number> {
  const out: Record<number, number> = {};
  if (!row.years) return out;
  for (const [y, v] of Object.entries(row.years)) {
    out[+y] = toPesos(v && v.amount);
  }
  return out;
}

export function totalAcrossYears(row: { years?: YearMap }): number {
  let s = 0;
  for (const v of Object.values(row.years || {})) s += toPesos(v && v.amount);
  return s;
}

async function fetchJson<T>(path: string): Promise<T> {
  const r = await fetch(path);
  if (!r.ok) throw new Error('Could not fetch ' + path + ' (' + r.status + ')');
  return (await r.json()) as T;
}

export interface BudgetData {
  agencies: (Agency & { meta: { short?: string; tone?: string; note?: string }; yearAmounts: Record<number, number>; total: number })[];
  fpaps: (FPAP & { yearAmounts: Record<number, number>; total: number })[];
  years: number[];
  yearTotal: Record<number, number>;
  yearlyTotalsRaw: { year: number; amount: number; count: number }[];
}

export async function loadBudget(): Promise<BudgetData> {
  const base = (import.meta.env.BASE_URL || '/').replace(/\/$/, '');
  const url = (p: string) => `${base}/data/${p}`;

  const [agencies, fpaps, yearlyTotals] = await Promise.all([
    fetchJson<RawDataset<Agency>>(url('agencies.json')),
    fetchJson<RawDataset<FPAP>>(url('fpaps.json')),
    fetchJson<RawDataset<{ year: number; count: number; amount: number }>>(url('yearly_totals.json')),
  ]);

  const years = yearlyTotals.data.map((r) => +r.year).sort();
  const yearTotal: Record<number, number> = {};
  for (const r of yearlyTotals.data) yearTotal[+r.year] = toPesos(r.amount);

  const enrichedAgencies = agencies.data.map((a) => ({
    ...a,
    meta: AGENCY_META[a.id] || {},
    yearAmounts: yearAmounts(a),
    total: totalAcrossYears(a),
  }));

  const enrichedFpaps = fpaps.data.map((f) => ({
    ...f,
    yearAmounts: yearAmounts(f),
    total: totalAcrossYears(f),
  }));

  return {
    agencies: enrichedAgencies,
    fpaps: enrichedFpaps,
    years,
    yearTotal,
    yearlyTotalsRaw: yearlyTotals.data.map((r) => ({ year: +r.year, amount: toPesos(r.amount), count: r.count })),
  };
}
