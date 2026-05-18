/**
 * JSON → Parquet converter for ai-reports.
 *
 * Each source JSON has shape `{ metadata, data: [{ ..., years: { "2020": {count,amount}, ... } }] }`.
 * We unpivot `years` into rows so the Parquet schema is flat columnar-friendly:
 *   (id, slug, *_code, description, ...fk_ids, department_id, year INT, count BIGINT, amount DOUBLE)
 *
 * Output: data/{deptId}/{table}.parquet (sibling of the source JSON, so the existing
 * /data → public/data symlink picks them up automatically).
 *
 * Run a single dept/table:  npm run build:parquet -- --dept=07 --table=objects
 * Run all heavy tables:     npm run build:parquet -- --all
 */

import { DuckDBInstance } from "@duckdb/node-api";
import { existsSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const HEAVY_TABLES = [
  "objects",
  "expenses",
  "fund_subcategories",
  "operating_units",
  "fpaps",
] as const;

type HeavyTable = (typeof HEAVY_TABLES)[number];

const SLUG_COLS: Record<HeavyTable, string> = {
  objects: "object_code",
  expenses: "expense_code",
  fund_subcategories: "fund_code",
  operating_units: "operunit_code",
  fpaps: "fpap_code",
};

const FK_COLS: Record<HeavyTable, string[]> = {
  objects: ["expense_id", "fund_id", "operating_unit_id", "fpap_id", "agency_id"],
  expenses: ["fund_id", "operating_unit_id", "fpap_id", "agency_id"],
  fund_subcategories: ["operating_unit_id", "fpap_id", "agency_id"],
  operating_units: ["fpap_id", "agency_id"],
  fpaps: ["agency_id"],
};

function parseArgs(): { dept?: string; table?: HeavyTable; all: boolean; force: boolean } {
  const args = process.argv.slice(2);
  const get = (k: string) =>
    args.find((a) => a.startsWith(`--${k}=`))?.split("=")[1];
  const table = get("table") as HeavyTable | undefined;
  if (table && !HEAVY_TABLES.includes(table)) {
    throw new Error(`Unknown table "${table}". Allowed: ${HEAVY_TABLES.join(", ")}`);
  }
  return {
    dept: get("dept"),
    table,
    all: args.includes("--all"),
    force: args.includes("--force"),
  };
}

function listDepts(dataRoot: string): string[] {
  return readdirSync(dataRoot)
    .filter((d) => /^\d{2}$/.test(d))
    .filter((d) => statSync(resolve(dataRoot, d)).isDirectory())
    .sort();
}

import { rmSync } from "node:fs";

async function convert(
  conn: Awaited<ReturnType<Awaited<ReturnType<typeof DuckDBInstance.create>>["connect"]>>,
  deptId: string,
  table: HeavyTable,
  dataRoot: string,
  opts: { overwrite: boolean },
): Promise<{ skipped: boolean; reason?: string; rows?: bigint; jsonSize?: number; parquetSize?: number; ms?: number }> {
  const src = resolve(dataRoot, deptId, `${table}.json`);
  // Hive-partitioned output: data/{dept}/{table}/year=YYYY/data_0.parquet.
  // Each year is its own file → file-level pruning, no row-group games needed.
  const dst = resolve(dataRoot, deptId, table);
  if (!existsSync(src)) return { skipped: true, reason: "no source" };
  if (existsSync(dst) && !opts.overwrite) {
    return { skipped: true, reason: "already exists (use --force)" };
  }
  if (opts.overwrite && existsSync(dst)) rmSync(dst, { recursive: true, force: true });

  const slug = SLUG_COLS[table];
  const fks = FK_COLS[table];
  const fkSelect = fks.map((c) => `r.${c}`).join(", ");

  // DuckDB infers `years` as a STRUCT with literal keys (e.g. "2020".."2026")
  // — not a MAP — so we have to enumerate keys statically. Different depts
  // have different year ranges (e.g. dept 40 only has 2023–2026), so probe
  // the source's `years` struct schema and build LATERAL VALUES from that.
  const escSrc = src.replace(/'/g, "''");
  const yearsSchema = await conn.runAndReadAll(
    `SELECT typeof(data[1].years) AS t
     FROM read_json_auto('${escSrc}', maximum_object_size = 1073741824)
     LIMIT 1`,
  );
  const typeStr = String(yearsSchema.getRows()[0][0]); // e.g. STRUCT("2020" STRUCT(...), "2021" ...)
  const yearKeys = Array.from(typeStr.matchAll(/"(\d{4})"/g), (m) => Number(m[1]));
  if (yearKeys.length === 0) {
    throw new Error(`Could not detect year keys in ${src}`);
  }
  const unpivot = yearKeys
    .map((y) => `(${y}, r.years."${y}".count, r.years."${y}".amount)`)
    .join(",\n        ");

  const sql = `
    COPY (
      WITH src AS (
        SELECT unnest(data) AS r
        FROM read_json_auto('${src.replace(/'/g, "''")}',
                            maximum_object_size = 1073741824)
      )
      SELECT
        r.id            AS id,
        r.slug          AS slug,
        r.${slug}       AS code,
        r.description   AS description,
        ${fkSelect ? fkSelect + "," : ""}
        r.department_id AS department_id,
        y.year          AS year,
        CAST(y.count  AS BIGINT) AS count,
        CAST(y.amount AS DOUBLE) AS amount
      FROM src r,
      LATERAL (VALUES
        ${unpivot}
      ) AS y(year, count, amount)
    )
    TO '${dst.replace(/'/g, "''")}'
    (FORMAT PARQUET,
     COMPRESSION ZSTD,
     PARTITION_BY (year),
     OVERWRITE_OR_IGNORE,
     ROW_GROUP_SIZE 200000);
  `;

  const t0 = performance.now();
  await conn.run(sql);
  const ms = performance.now() - t0;

  const jsonSize = statSync(src).size;
  const parquetSize = walkDirSize(dst);
  const glob = `${dst.replace(/'/g, "''")}/**/*.parquet`;
  const rowsResult = await conn.runAndReadAll(
    `SELECT COUNT(*) AS n FROM read_parquet('${glob}', hive_partitioning = true)`,
  );
  const rows = rowsResult.getRows()[0][0] as bigint;
  return { skipped: false, rows, jsonSize, parquetSize, ms };
}

function walkDirSize(dir: string): number {
  if (!existsSync(dir)) return 0;
  let total = 0;
  for (const name of readdirSync(dir)) {
    const p = resolve(dir, name);
    const s = statSync(p);
    total += s.isDirectory() ? walkDirSize(p) : s.size;
  }
  return total;
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)}MB`;
  return `${(n / 1024 ** 3).toFixed(2)}GB`;
}

async function main() {
  const args = parseArgs();
  const dataRoot = resolve(process.cwd(), "data");
  if (!existsSync(dataRoot)) throw new Error(`data/ not found at ${dataRoot}`);

  const depts = args.all
    ? listDepts(dataRoot)
    : args.dept
      ? [args.dept]
      : (() => {
          throw new Error("Pass --all or --dept=NN");
        })();
  const tables = args.table ? [args.table] : HEAVY_TABLES;

  const db = await DuckDBInstance.create(":memory:", { threads: "4" });
  const conn = await db.connect();

  process.stdout.write(`Converting ${depts.length} dept(s) × ${tables.length} table(s)\n`);
  process.stdout.write("─".repeat(72) + "\n");

  let totalJson = 0;
  let totalParquet = 0;
  for (const deptId of depts) {
    for (const table of tables) {
      const label = `  ${deptId}/${table.padEnd(20)}`;
      process.stdout.write(label + "  …\r");
      try {
        const r = await convert(conn, deptId, table, dataRoot, { overwrite: args.force });
        if (r.skipped) {
          process.stdout.write(`${label}  (${r.reason})\n`);
          continue;
        }
        totalJson += r.jsonSize!;
        totalParquet += r.parquetSize!;
        const ratio = (r.jsonSize! / r.parquetSize!).toFixed(1);
        process.stdout.write(
          `${label}  ${fmtBytes(r.jsonSize!).padStart(8)} → ${fmtBytes(r.parquetSize!).padStart(8)}  (${ratio}x, ${r.rows} rows, ${(r.ms! / 1000).toFixed(1)}s)\n`,
        );
      } catch (e) {
        process.stdout.write(`${label}  FAILED: ${(e as Error).message}\n`);
      }
    }
  }
  process.stdout.write("─".repeat(72) + "\n");
  if (totalParquet > 0) {
    process.stdout.write(
      `TOTAL  ${fmtBytes(totalJson)} → ${fmtBytes(totalParquet)}  (${(totalJson / totalParquet).toFixed(1)}x reduction)\n`,
    );
  }

  // Manifests: one per dept, listing { table: [year, ...] } so the browser
  // can construct read_parquet([...]) URL lists without HTTP directory listing.
  for (const deptId of depts) {
    const manifest: Record<string, { years: number[]; bytes: number }> = {};
    for (const table of HEAVY_TABLES) {
      const tdir = resolve(dataRoot, deptId, table);
      if (!existsSync(tdir)) continue;
      const years: number[] = [];
      let bytes = 0;
      for (const dir of readdirSync(tdir)) {
        const m = dir.match(/^year=(\d+)$/);
        if (!m) continue;
        years.push(Number(m[1]));
        const f = resolve(tdir, dir, "data_0.parquet");
        if (existsSync(f)) bytes += statSync(f).size;
      }
      if (years.length > 0) {
        years.sort();
        manifest[table] = { years, bytes };
      }
    }
    if (Object.keys(manifest).length > 0) {
      const out = resolve(dataRoot, deptId, "parquet_manifest.json");
      writeFileSync(out, JSON.stringify(manifest, null, 2));
      process.stdout.write(`  wrote ${deptId}/parquet_manifest.json (${Object.keys(manifest).length} tables)\n`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
