/**
 * Quick parquet probe: schema, row count, and a representative query.
 * Run: npm run inspect:parquet -- data/07/objects.parquet
 */
import { DuckDBInstance } from "@duckdb/node-api";

async function main() {
  const path = process.argv[2];
  if (!path) throw new Error("usage: tsx scripts/inspect-parquet.ts <file>");

  const db = await DuckDBInstance.create(":memory:");
  const conn = await db.connect();

  const esc = path.replace(/'/g, "''");

  console.log("─── schema ─────────────────────────────────────────────");
  const schema = await conn.runAndReadAll(
    `DESCRIBE SELECT * FROM read_parquet('${esc}')`,
  );
  for (const row of schema.getRows()) {
    console.log(`  ${String(row[0]).padEnd(20)} ${row[1]}`);
  }

  console.log("\n─── row groups ─────────────────────────────────────────");
  const meta = await conn.runAndReadAll(
    `SELECT row_group_id,
            SUM(num_values) AS num_values,
            SUM(row_group_compressed_bytes) AS compressed
     FROM parquet_metadata('${esc}')
     GROUP BY row_group_id
     ORDER BY row_group_id LIMIT 12`,
  );
  for (const row of meta.getRows()) {
    console.log(`  rg ${row[0]}: ${row[1]} values across columns, ${row[2]} bytes compressed`);
  }

  console.log("\n─── sample query: top 10 objects in year 2026 ──────────");
  const t0 = performance.now();
  const top = await conn.runAndReadAll(
    `SELECT code, description, amount
     FROM read_parquet('${esc}')
     WHERE year = 2026
     ORDER BY amount DESC LIMIT 10`,
  );
  const ms = performance.now() - t0;
  for (const row of top.getRows()) {
    const code = String(row[0]).slice(0, 8);
    const desc = String(row[1]).slice(0, 50);
    console.log(`  ${code.padEnd(10)} ${desc.padEnd(52)} ₱${Number(row[2]).toLocaleString()}`);
  }
  console.log(`  (${ms.toFixed(1)}ms local-disk read)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
