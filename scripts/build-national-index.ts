/**
 * Build-time aggregator. Reads each per-department `departments.json` and
 * `yearly_totals.json` and produces `public/data/national/index.json` —
 * a ~tiny file the National landing page loads instead of all 3.7GB.
 *
 * Run: `npm run build:index`
 */
import { readFile, readdir, writeFile, mkdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';

const DATA_DIR = join(process.cwd(), 'data');
const OUT_PATH = join(process.cwd(), 'public', 'data', 'national', 'index.json');
const SCALE = 1000; // source data is in thousands of pesos

type YearMap = Record<number, { count: number; amount: number }>;
interface DeptRow {
  id: string;
  slug: string;
  description: string;
  years: YearMap;
  has_data: boolean;
}

async function readJsonIfExists<T>(path: string): Promise<T | null> {
  if (!existsSync(path)) return null;
  try {
    const txt = await readFile(path, 'utf8');
    return JSON.parse(txt) as T;
  } catch {
    return null;
  }
}

async function main() {
  const entries = await readdir(DATA_DIR, { withFileTypes: true });
  const deptDirs = entries
    .filter((e) => e.isDirectory() && /^\d{2}$/.test(e.name))
    .map((e) => e.name)
    .sort();

  const years = new Set<number>();
  const depts: DeptRow[] = [];

  for (const deptId of deptDirs) {
    const dir = join(DATA_DIR, deptId);
    const deptDoc = await readJsonIfExists<{ data: Array<{ id: string; slug: string; description: string; years: YearMap }> }>(
      join(dir, 'departments.json'),
    );
    const yearlyDoc = await readJsonIfExists<{ data: Array<{ year: number; count: number; amount: number }> }>(
      join(dir, 'yearly_totals.json'),
    );

    const head = deptDoc?.data?.[0];
    const hasYearly = !!yearlyDoc?.data?.length;
    const years_: YearMap = {};
    yearlyDoc?.data?.forEach((r) => {
      years_[r.year] = { count: r.count, amount: (r.amount || 0) * SCALE };
      years.add(r.year);
    });

    depts.push({
      id: deptId,
      slug: head?.slug ?? `dept-${deptId}`,
      description: head?.description ?? `Department ${deptId}`,
      years: years_,
      has_data: hasYearly,
    });
  }

  const yearsArr = [...years].sort((a, b) => a - b);
  const nationalYearly = yearsArr.map((year) => {
    let count = 0;
    let amount = 0;
    for (const d of depts) {
      const y = d.years[year];
      if (y) {
        count += y.count;
        amount += y.amount;
      }
    }
    return { year, count, amount };
  });

  // Department-level movers: latest vs previous fiscal year
  const latest = yearsArr[yearsArr.length - 1];
  const prev = yearsArr[yearsArr.length - 2];
  const movers = depts
    .filter((d) => d.has_data)
    .map((d) => ({
      id: d.id,
      description: d.description,
      curr_amount: d.years[latest]?.amount || 0,
      prev_amount: d.years[prev]?.amount || 0,
      delta: (d.years[latest]?.amount || 0) - (d.years[prev]?.amount || 0),
    }));

  const top_movers_up = [...movers].sort((a, b) => b.delta - a.delta).slice(0, 8);
  const top_movers_down = [...movers].sort((a, b) => a.delta - b.delta).slice(0, 8);

  const out = {
    generated_at: new Date().toISOString(),
    years: yearsArr,
    national_yearly: nationalYearly,
    departments: depts,
    top_movers_up,
    top_movers_down,
  };

  await mkdir(dirname(OUT_PATH), { recursive: true });
  await writeFile(OUT_PATH, JSON.stringify(out, null, 2));

  const st = await stat(OUT_PATH);
  console.log(
    `wrote ${OUT_PATH}\n` +
    `  ${depts.length} departments (${depts.filter((d) => d.has_data).length} with data)\n` +
    `  ${yearsArr.length} fiscal years: ${yearsArr.join(', ')}\n` +
    `  national FY${latest}: ₱${(nationalYearly[nationalYearly.length - 1].amount / 1e12).toFixed(2)}T\n` +
    `  size: ${(st.size / 1024).toFixed(1)} KB`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
