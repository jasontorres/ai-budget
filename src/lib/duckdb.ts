/**
 * DuckDB-WASM singleton for ai-reports browser-side data access.
 *
 * Loads the bundled wasm worker on first call, then exposes `runQuery` that
 * range-reads parquet files served from `/data/{deptId}/*.parquet`.
 *
 * The httpfs extension auto-loads when read_parquet is called against a URL;
 * Vite's dev server and most static hosts honor Range requests, so DuckDB
 * fetches only the row groups + columns needed for each query.
 */
import * as duckdb from "@duckdb/duckdb-wasm";
import { dataDeptUrl } from "./data-url";

let dbPromise: Promise<duckdb.AsyncDuckDB> | null = null;

async function initDb(): Promise<duckdb.AsyncDuckDB> {
  const bundles = duckdb.getJsDelivrBundles();
  const bundle = await duckdb.selectBundle(bundles);

  // Worker module loaded from a Blob URL so cross-origin doesn't bite us.
  const workerBlob = new Blob(
    [`importScripts("${bundle.mainWorker!}");`],
    { type: "text/javascript" },
  );
  const worker = new Worker(URL.createObjectURL(workerBlob));
  const logger = new duckdb.ConsoleLogger(duckdb.LogLevel.WARNING);
  const db = new duckdb.AsyncDuckDB(logger, worker);
  await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
  return db;
}

export function getDb(): Promise<duckdb.AsyncDuckDB> {
  if (!dbPromise) dbPromise = initDb();
  return dbPromise;
}

export interface QueryResult<Row = Record<string, unknown>> {
  rows: Row[];
  ms: number;
}

/**
 * Run a SQL query on a fresh connection so concurrent runQuery() calls
 * actually parallelize. A single DuckDB connection serializes its workload,
 * which would defeat Promise.all on Stage B's four-query fan-out.
 */
export async function runQuery<Row = Record<string, unknown>>(
  sql: string,
  params: ReadonlyArray<string | number | bigint | null> = [],
): Promise<QueryResult<Row>> {
  const db = await getDb();
  const conn = await db.connect();
  const t0 = performance.now();
  try {
    let result;
    if (params.length === 0) {
      result = await conn.query(sql);
    } else {
      const stmt = await conn.prepare(sql);
      try {
        result = await stmt.query(...(params as never[]));
      } finally {
        await stmt.close();
      }
    }
    const ms = performance.now() - t0;
    // Arrow Table → plain JS rows. Numbers from BIGINT come back as bigint;
    // callers can coerce as needed.
    const rows = result.toArray().map((r) => r.toJSON() as Row);
    return { rows, ms };
  } finally {
    await conn.close();
  }
}

export interface ParquetManifest {
  [table: string]: { years: number[]; bytes: number };
}

const manifestCache = new Map<string, Promise<ParquetManifest>>();

export function loadManifest(deptId: string): Promise<ParquetManifest> {
  let p = manifestCache.get(deptId);
  if (!p) {
    p = fetch(`${dataDeptUrl(deptId)}/parquet_manifest.json`).then((r) => {
      if (!r.ok) throw new Error(`No parquet manifest for dept ${deptId} (HTTP ${r.status})`);
      return r.json() as Promise<ParquetManifest>;
    });
    manifestCache.set(deptId, p);
  }
  return p;
}

/**
 * Build a SQL list literal of fully-qualified parquet URLs for a dept's table,
 * optionally filtered to years. Used directly in `read_parquet([...])`.
 */
export function parquetUrls(
  deptId: string,
  table: string,
  manifest: ParquetManifest,
  yearFilter?: ReadonlyArray<number>,
): string {
  const meta = manifest[table];
  if (!meta) throw new Error(`Table "${table}" not in manifest for dept ${deptId}`);
  const ys = yearFilter ? meta.years.filter((y) => yearFilter.includes(y)) : meta.years;
  // DuckDB-WASM needs absolute URLs; resolve relative bases against the page origin.
  const baseRaw = dataDeptUrl(deptId);
  const base = baseRaw.startsWith("http") ? baseRaw : `${window.location.origin}${baseRaw}`;
  const list = ys.map((y) => `'${base}/${table}/year=${y}/data_0.parquet'`).join(", ");
  return `[${list}]`;
}
