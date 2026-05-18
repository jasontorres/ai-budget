import { DuckDBInstance } from "@duckdb/node-api";
const file = process.argv[2] || "data/07/objects/year=2026/data_0.parquet";
const db = await DuckDBInstance.create(":memory:");
const conn = await db.connect();
const r = await conn.runAndReadAll(
  `SELECT path_in_schema,
          SUM(total_compressed_size) AS comp,
          SUM(total_uncompressed_size) AS uncomp,
          SUM(num_values) AS n
   FROM parquet_metadata('${file}')
   GROUP BY path_in_schema ORDER BY comp DESC`,
);
console.log(`\nColumn sizes for ${file}`);
console.log("col                  | compressed   | uncompressed | values");
console.log("---------------------+--------------+--------------+----------");
let total = 0;
for (const row of r.getRows()) {
  const col = String(row[0]).padEnd(20);
  const cmp = Number(row[1]);
  const ucmp = Number(row[2]);
  total += cmp;
  console.log(
    `${col} | ${(cmp / 1024 / 1024).toFixed(2).padStart(7)} MB  | ${(ucmp / 1024 / 1024).toFixed(2).padStart(7)} MB  | ${row[3]}`,
  );
}
console.log(`TOTAL compressed: ${(total / 1024 / 1024).toFixed(2)} MB`);
process.exit(0);
