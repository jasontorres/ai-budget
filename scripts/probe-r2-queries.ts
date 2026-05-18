/**
 * End-to-end smoke test of the Stage B/C queries against the live R2 endpoint.
 * Mirrors `dept-data.ts:loadParquetTable` SQL exactly, but runs via node-api
 * so we can confirm the data path before testing in a real browser.
 */
import { DuckDBInstance } from "@duckdb/node-api";

const BASE = "https://budget-assets.bettergov.ph";

interface Manifest {
  [table: string]: { years: number[]; bytes: number };
}

const SPECS: Record<string, { codeCol: string; fkCols: string[] }> = {
  fpaps: { codeCol: "fpap_code", fkCols: ["agency_id"] },
  operating_units: { codeCol: "operunit_code", fkCols: ["fpap_id", "agency_id"] },
  fund_subcategories: {
    codeCol: "fund_code",
    fkCols: ["operating_unit_id", "fpap_id", "agency_id"],
  },
  expenses: {
    codeCol: "expense_code",
    fkCols: ["fund_id", "operating_unit_id", "fpap_id", "agency_id"],
  },
  objects: {
    codeCol: "object_code",
    fkCols: ["expense_id", "fund_id", "operating_unit_id", "fpap_id", "agency_id"],
  },
};

function parquetUrls(deptId: string, table: string, manifest: Manifest): string {
  const meta = manifest[table];
  const list = meta.years
    .map((y) => `'${BASE}/${deptId}/${table}/year=${y}/data_0.parquet'`)
    .join(", ");
  return `[${list}]`;
}

async function main() {
  const dept = process.argv[2] || "05";
  console.log(`Probing dept ${dept} via ${BASE}`);

  const manifestRes = await fetch(`${BASE}/${dept}/parquet_manifest.json`);
  if (!manifestRes.ok) throw new Error(`manifest HTTP ${manifestRes.status}`);
  const manifest = (await manifestRes.json()) as Manifest;
  console.log("manifest tables:", Object.keys(manifest));

  const db = await DuckDBInstance.create(":memory:");
  const conn = await db.connect();
  await conn.run("INSTALL httpfs;");
  await conn.run("LOAD httpfs;");

  const YEARS = [2020, 2021, 2022, 2023, 2024, 2025, 2026];
  for (const [table, spec] of Object.entries(SPECS)) {
    if (!manifest[table]) {
      console.log(`  ${table}: not in manifest`);
      continue;
    }
    const urls = parquetUrls(dept, table, manifest);
    const fkSelect = spec.fkCols.map((c) => `ANY_VALUE(${c}) AS ${c}`).join(",\n      ");
    const yearAggs = YEARS.flatMap((y) => [
      `SUM(amount) FILTER (WHERE year = ${y}) AS amount_${y}`,
      `SUM(count)  FILTER (WHERE year = ${y}) AS count_${y}`,
    ]).join(",\n      ");
    const sql = `
      SELECT
        id,
        ANY_VALUE(slug) AS slug,
        ANY_VALUE(code) AS code,
        ANY_VALUE(description) AS description,
        ${fkSelect}${spec.fkCols.length ? "," : ""}
        ANY_VALUE(department_id) AS department_id,
        ${yearAggs}
      FROM read_parquet(${urls}, hive_partitioning = true)
      GROUP BY id
    `;
    const t0 = performance.now();
    const res = await conn.runAndReadAll(sql);
    const ms = performance.now() - t0;
    const rows = res.getRows();
    console.log(`  ${table}: ${rows.length} rows in ${ms.toFixed(0)} ms`);
    if (rows.length > 0) {
      const first = rows[0];
      console.log(`    sample row col count: ${first.length}`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
