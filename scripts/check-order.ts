import { DuckDBInstance } from '@duckdb/node-api';
async function main() {
  const db = await DuckDBInstance.create(':memory:');
  const c = await db.connect();
  const r = await c.runAndReadAll(
    `SELECT year, COUNT(*) AS n FROM read_parquet('data/07/objects.parquet') GROUP BY year ORDER BY year`,
  );
  for (const row of r.getRows()) console.log('year', row[0], 'count', row[1]);
  console.log('---');
  // Check year sequence in raw row order via row_number trick
  const r2 = await c.runAndReadAll(
    `WITH src AS (
       SELECT *, row_number() OVER () AS rn FROM read_parquet('data/07/objects.parquet')
     )
     SELECT MIN(rn) AS first_rn, MAX(rn) AS last_rn, year, COUNT(*) AS n
     FROM src GROUP BY year ORDER BY first_rn`,
  );
  console.log('first_rn  last_rn  year  count');
  for (const row of r2.getRows()) console.log(row.map((v) => String(v).padStart(10)).join(' '));
}
main().catch((e) => { console.error(e); process.exit(1); });
