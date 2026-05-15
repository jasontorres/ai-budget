export interface YearData {
  count: number;
  amount: number;
}

export type YearMap = Record<number, YearData>;

export interface BaseEntity {
  id: string;
  slug: string;
  description: string;
  years: YearMap;
}

export interface Department extends BaseEntity {
  department_id: string;
}

export interface Agency extends BaseEntity {
  agency_code: string;
  department_id: string;
}

export interface FPAP extends BaseEntity {
  fpap_code: string;
  agency_id: string;
  department_id: string;
}

export interface OperatingUnit extends BaseEntity {
  operunit_code?: string;
  fpap_id: string;
  agency_id: string;
  department_id: string;
}

export interface Fund extends BaseEntity {
  fund_code?: string;
  operating_unit_id: string;
  fpap_id: string;
  agency_id: string;
  department_id: string;
}

export interface Expense extends BaseEntity {
  expense_code: string;
  fund_id: string;
  operating_unit_id: string;
  fpap_id: string;
  agency_id: string;
  department_id: string;
}

export interface ObjectItem extends BaseEntity {
  object_code: string;
  expense_id: string;
  fund_id: string;
  operating_unit_id: string;
  fpap_id: string;
  agency_id: string;
  department_id: string;
}

export interface FPAPFamily {
  key: string;
  agency_id: string;
  name: string;
  ids: string[];
  years: YearMap;
}

export interface YearlyTotalRow {
  year: number;
  count: number;
  amount: number;
}

export interface ExpenseClassBreakdown {
  PS: number;
  MOOE: number;
  CO: number;
  FE: number;
}

export interface ExpenseClassMeta {
  key: 'PS' | 'MOOE' | 'CO' | 'FE';
  label: string;
  color: string;
}

export interface MoverEntry {
  fam: FPAPFamily;
  delta: number;
}

export interface DeptData {
  YEARS: number[];
  EXPENSE_CLASS: Record<string, ExpenseClassMeta>;

  department: { id: string; description: string; years: Record<number, YearData> };
  yearly: YearlyTotalRow[];

  agencies: Agency[];
  agencyById: Record<string, Agency>;

  fpaps: FPAP[];
  fpapById: Record<string, FPAP>;
  fpapsByAgency: Record<string, FPAP[]>;
  fpapFamilies: FPAPFamily[];

  opUnits: OperatingUnit[];
  opUnitById: Record<string, OperatingUnit>;
  funds: Fund[];
  fundById: Record<string, Fund>;
  objects: ObjectItem[];
  expenses: Expense[];

  expenseClassByYear: Record<number, ExpenseClassBreakdown>;
  expenseClassByAgencyYear: Record<string, Record<number, ExpenseClassBreakdown>>;

  /** True once the Stage B files (fpaps, op_units, fund_subcategories, expenses) are loaded. */
  midLoaded: boolean;
  /** True once objects.json has been lazy-loaded into this dataset. */
  objectsLoaded: boolean;
  /** True if expenses.json was too large to ship and was skipped. */
  expensesSkipped: boolean;

  total: (year: number) => number;
  totalOver: (rec: { years: YearMap }, years?: number[]) => number;
  maxOver: (rec: { years: YearMap }, years?: number[]) => number;
  normName: (s: string) => string;
  topMovers: (direction?: 'up' | 'down', year?: number, prev?: number, n?: number) => MoverEntry[];
}

export interface RawDataset<T> {
  metadata?: Record<string, unknown>;
  data: T[];
}

export interface NationalIndex {
  generated_at: string;
  years: number[];
  national_yearly: YearlyTotalRow[];
  departments: NationalDeptRow[];
  top_movers_up: NationalMoverRow[];
  top_movers_down: NationalMoverRow[];
}

export interface NationalDeptRow {
  id: string;
  slug: string;
  description: string;
  years: YearMap;
  sector?: string;
  has_data: boolean;
}

export interface NationalMoverRow {
  id: string;
  description: string;
  delta: number;
  prev_amount: number;
  curr_amount: number;
}
