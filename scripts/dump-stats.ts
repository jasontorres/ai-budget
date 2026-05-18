import { DuckDBInstance } from "@duckdb/node-api";

const db = await DuckDBInstance.create(":memory:");
const conn = await db.connect();
const file = process.argv[2] || "data/07/objects.parquet";

const m = await conn.runAndReadAll(
  `SELECT row_group_id, path_in_schema, stats_min, stats_max
   FROM parquet_metadata('${file}')
   WHERE path_in_schema IN ('year','agency_id','amount')
   ORDER BY row_group_id LIMIT 80`,
);
console.log("rg | column         | min            | max");
console.log("---+----------------+----------------+----------------");
for (const r of m.getRows()) {
  const rg = String(r[0]).padStart(2);
  const col = String(r[1]).padEnd(14);
  const mn = String(r[2]).padEnd(14).slice(0, 14);
  const mx = String(r[3]).padEnd(14).slice(0, 14);
  console.log(`${rg} | ${col} | ${mn} | ${mx}`);
}

const counts = await conn.runAndReadAll(
  `SELECT row_group_id, COUNT(*) FROM parquet_metadata('${file}') GROUP BY row_group_id ORDER BY 1`,
);
console.log(`\nRow groups: ${counts.getRows().length}`);
