/**
 * Sanity-check the SQL that `dept-data.ts:loadParquetTable` issues, run
 * against the local parquet tree. Confirms row shape, year aggregation,
 * and BIGINT handling.
 */
import { DuckDBInstance } from "@duckdb/node-api";

const SPECS = [
  { table: "fpaps", codeCol: "fpap_code", fkCols: ["agency_id"] },
  { table: "operating_units", codeCol: "operunit_code", fkCols: ["fpap_id", "agency_id"] },
  {
    table: "fund_subcategories",
    codeCol: "fund_code",
    fkCols: ["operating_unit_id", "fpap_id", "agency_id"],
  },
  {
    table: "expenses",
    codeCol: "expense_code",
    fkCols: ["fund_id", "operating_unit_id", "fpap_id", "agency_id"],
  },
  {
    table: "objects",
    codeCol: "object_code",
    fkCols: ["expense_id", "fund_id", "operating_unit_id", "fpap_id", "agency_id"],
  },
];

async function main() {
  const dept = process.argv[2] || "05";
  const db = await DuckDBInstance.create(":memory:");
  const conn = await db.connect();

  for (const spec of SPECS) {
    const fkSelect = spec.fkCols.map((c) => `ANY_VALUE(${c}) AS ${c}`).join(",\n      ");
    const glob = `data/${dept}/${spec.table}/**/*.parquet`;
    const sql = `
      SELECT
        id,
        ANY_VALUE(slug) AS slug,
        ANY_VALUE(code) AS code,
        ANY_VALUE(description) AS description,
        ${fkSelect}${spec.fkCols.length ? "," : ""}
        ANY_VALUE(department_id) AS department_id,
        LIST(STRUCT_PACK(year, count, amount) ORDER BY year) AS year_entries
      FROM read_parquet('${glob}', hive_partitioning = true)
      GROUP BY id
      LIMIT 3
    `;
    const t0 = performance.now();
    const r = await conn.runAndReadAll(sql);
    const ms = performance.now() - t0;
    const rows = r.getRows();
    const cnt = await conn.runAndReadAll(
      `SELECT COUNT(DISTINCT id) FROM read_parquet('${glob}', hive_partitioning = true)`,
    );
    const totalIds = cnt.getRows()[0][0];
    console.log(
      `\n── dept ${dept} / ${spec.table}: ${totalIds} unique ids, query ${ms.toFixed(0)} ms`,
    );
    for (const row of rows) {
      console.log("  row:", row);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
