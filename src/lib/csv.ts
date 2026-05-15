import type { DeptData, ObjectItem } from './types';

const EXPENSE_CLASS_LABELS: Record<string, string> = {
  '1': 'PS',
  '2': 'MOOE',
  '3': 'FE',
  '4': 'CO',
  '5': 'CO',
};

export interface ColumnDef {
  key: string;
  label: string;
  numeric: boolean;
  group: 'id' | 'breadcrumb' | 'object' | 'year-amount' | 'year-count' | 'total';
  width?: number;
  year?: number;
}

export type RawCell = string | number;

export function buildColumns(years: number[]): ColumnDef[] {
  const cols: ColumnDef[] = [
    { key: 'department_id', label: 'dept_id', numeric: false, group: 'id', width: 70 },
    { key: 'department', label: 'department', numeric: false, group: 'breadcrumb', width: 240 },
    { key: 'agency_id', label: 'agency_id', numeric: false, group: 'id', width: 90 },
    { key: 'agency', label: 'agency', numeric: false, group: 'breadcrumb', width: 220 },
    { key: 'fpap_id', label: 'fpap_id', numeric: false, group: 'id', width: 200 },
    { key: 'fpap_code', label: 'fpap_code', numeric: false, group: 'id', width: 130 },
    { key: 'fpap', label: 'fpap (program)', numeric: false, group: 'breadcrumb', width: 260 },
    { key: 'operating_unit_id', label: 'operating_unit_id', numeric: false, group: 'id', width: 200 },
    { key: 'operating_unit', label: 'operating_unit', numeric: false, group: 'breadcrumb', width: 220 },
    { key: 'fund_id', label: 'fund_id', numeric: false, group: 'id', width: 220 },
    { key: 'fund', label: 'fund', numeric: false, group: 'breadcrumb', width: 220 },
    { key: 'expense_id', label: 'expense_id', numeric: false, group: 'id', width: 240 },
    { key: 'expense_class_code', label: 'ec_code', numeric: false, group: 'id', width: 80 },
    { key: 'expense_class', label: 'ec', numeric: false, group: 'breadcrumb', width: 70 },
    { key: 'expense_class_description', label: 'expense_class', numeric: false, group: 'breadcrumb', width: 200 },
    { key: 'object_id', label: 'object_id', numeric: false, group: 'id', width: 280 },
    { key: 'object_code', label: 'uacs', numeric: false, group: 'object', width: 130 },
    { key: 'object_description', label: 'object', numeric: false, group: 'object', width: 280 },
  ];
  for (const y of years) {
    cols.push({ key: `amount_${y}`, label: `amt ${y}`, numeric: true, group: 'year-amount', width: 110, year: y });
    cols.push({ key: `count_${y}`, label: `cnt ${y}`, numeric: true, group: 'year-count', width: 70, year: y });
  }
  cols.push({ key: 'total_amount_php', label: '7y total ₱', numeric: true, group: 'total', width: 130 });
  cols.push({ key: 'total_count', label: '7y count', numeric: true, group: 'total', width: 90 });
  return cols;
}

export function buildRow(data: DeptData, o: ObjectItem, years: number[]): Record<string, RawCell> {
  const agency = data.agencyById[o.agency_id];
  const fpap = data.fpapById[o.fpap_id];
  const opUnit = data.opUnitById[o.operating_unit_id];
  const fund = data.fundById[o.fund_id];
  const expense = data.expenses.find((e) => e.id === o.expense_id);
  const expCode = (o.expense_id || '').split('-').pop() || '';
  const expClass = EXPENSE_CLASS_LABELS[expCode] || '';

  const row: Record<string, RawCell> = {
    department_id: o.department_id,
    department: 'Department of Information and Communications Technology',
    agency_id: o.agency_id,
    agency: agency?.description || '',
    fpap_id: o.fpap_id,
    fpap_code: fpap?.fpap_code || '',
    fpap: fpap?.description || '',
    operating_unit_id: o.operating_unit_id,
    operating_unit: opUnit?.description || '',
    fund_id: o.fund_id,
    fund: fund?.description || '',
    expense_id: o.expense_id,
    expense_class_code: expCode,
    expense_class: expClass,
    expense_class_description: expense?.description || '',
    object_id: o.id,
    object_code: o.object_code || '',
    object_description: o.description || '',
  };

  let totalAmt = 0;
  let totalCnt = 0;
  for (const y of years) {
    const v = o.years[y]?.amount || 0;
    const c = o.years[y]?.count || 0;
    row[`amount_${y}`] = v;
    row[`count_${y}`] = c;
    totalAmt += v;
    totalCnt += c;
  }
  row.total_amount_php = totalAmt;
  row.total_count = totalCnt;
  return row;
}

export function buildRows(
  data: DeptData,
  objects: ObjectItem[],
  years: number[] = data.YEARS,
): Record<string, RawCell>[] {
  return objects.map((o) => buildRow(data, o, years));
}

function escapeCell(val: unknown): string {
  if (val == null) return '';
  if (typeof val === 'number') return Number.isFinite(val) ? String(val) : '';
  const s = String(val);
  if (/["\n,]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export interface ObjectFilter {
  agencyId?: string;
  fpapId?: string;
  operatingUnitId?: string;
  fundId?: string;
  expenseId?: string;
  expenseClassCode?: string;
  year?: number;
  query?: string;
}

export function filterObjects(data: DeptData, filter: ObjectFilter): ObjectItem[] {
  const ql = (filter.query || '').trim().toLowerCase();
  return data.objects.filter((o) => {
    if (!o.description || o.description === 'nan') return false;
    if (filter.agencyId && o.agency_id !== filter.agencyId) return false;
    if (filter.fpapId && o.fpap_id !== filter.fpapId) return false;
    if (filter.operatingUnitId && o.operating_unit_id !== filter.operatingUnitId) return false;
    if (filter.fundId && o.fund_id !== filter.fundId) return false;
    if (filter.expenseId && o.expense_id !== filter.expenseId) return false;
    if (filter.expenseClassCode) {
      const code = (o.expense_id || '').split('-').pop();
      if (code !== filter.expenseClassCode) return false;
    }
    if (filter.year != null) {
      const amt = o.years[filter.year]?.amount || 0;
      if (!amt) return false;
    }
    if (ql) {
      const hay = `${o.description} ${o.object_code} ${o.slug || ''}`.toLowerCase();
      if (!hay.includes(ql)) return false;
    }
    return true;
  });
}

export function objectsToCsv(
  data: DeptData,
  objects: ObjectItem[],
  years: number[] = data.YEARS,
): string {
  const cols = buildColumns(years);
  const headers = cols.map((c) => c.key);
  const lines = [headers.join(',')];
  for (const o of objects) {
    const row = buildRow(data, o, years);
    lines.push(headers.map((k) => escapeCell(row[k])).join(','));
  }
  return lines.join('\n');
}

export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
