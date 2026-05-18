/**
 * Range-probe: measure how many bytes DuckDB pulls over HTTP for a typical
 * browser query. Same code path as duckdb-wasm; just runs in Node.
 *
 * Architecture:
 *   tsx scripts/range-probe.ts
 *     ├─ spins up a logging HTTP server on :7700 that serves data/ as-is
 *     │  but tallies every byte sent per URL.
 *     └─ runs DuckDB queries against http://localhost:7700/...
 */
import { DuckDBInstance } from "@duckdb/node-api";
import http from "node:http";
import { createReadStream, statSync } from "node:fs";
import { resolve } from "node:path";

const PORT = 7700;
const DATA_ROOT = resolve(process.cwd(), "data");

interface UrlStats {
  bytes: number;
  requests: number;
  ranges: string[];
}
const stats = new Map<string, UrlStats>();

function bump(url: string, bytes: number, range: string | undefined) {
  const cur = stats.get(url) || { bytes: 0, requests: 0, ranges: [] };
  cur.bytes += bytes;
  cur.requests += 1;
  if (range) cur.ranges.push(range);
  stats.set(url, cur);
}

const VERBOSE = process.env.VERBOSE === "1";
const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
  if (VERBOSE) {
    console.log(`  > ${req.method} ${urlPath}  Range=${req.headers.range || "(none)"}`);
  }
  // strip /data/ prefix to map onto DATA_ROOT
  const rel = urlPath.replace(/^\/+/, "");
  const file = resolve(DATA_ROOT, rel);
  if (!file.startsWith(DATA_ROOT)) {
    res.writeHead(403);
    res.end();
    return;
  }
  let size: number;
  try {
    size = statSync(file).size;
  } catch {
    res.writeHead(404);
    res.end();
    return;
  }
  if (req.method === "HEAD") {
    res.writeHead(200, {
      "Content-Length": String(size),
      "Accept-Ranges": "bytes",
      "Content-Type": "application/octet-stream",
    });
    res.end();
    bump(urlPath, 0, "HEAD");
    return;
  }
  const range = req.headers.range;
  const m = range?.match(/^bytes=(\d+)-(\d*)$/);
  if (m) {
    const start = Number(m[1]);
    const end = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1);
    const len = end - start + 1;
    res.writeHead(206, {
      "Content-Range": `bytes ${start}-${end}/${size}`,
      "Content-Length": String(len),
      "Accept-Ranges": "bytes",
      "Content-Type": "application/octet-stream",
    });
    const stream = createReadStream(file, { start, end });
    let sent = 0;
    stream.on("data", (c) => (sent += (c as Buffer).length));
    stream.on("end", () => bump(urlPath, sent, `${start}-${end}`));
    stream.pipe(res);
  } else {
    res.writeHead(200, {
      "Content-Length": String(size),
      "Accept-Ranges": "bytes",
      "Content-Type": "application/octet-stream",
    });
    const stream = createReadStream(file);
    let sent = 0;
    stream.on("data", (c) => (sent += (c as Buffer).length));
    stream.on("end", () => bump(urlPath, sent, undefined));
    stream.pipe(res);
  }
});

await new Promise<void>((r) => server.listen(PORT, "127.0.0.1", () => r()));
console.log(`probe-server up on :${PORT} (serving ${DATA_ROOT})\n`);

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 ** 2).toFixed(2)} MB`;
}

async function measure(name: string, fn: () => Promise<unknown>, opts: { showRanges?: boolean } = {}) {
  stats.clear();
  const t0 = performance.now();
  await fn();
  const ms = performance.now() - t0;
  console.log(`\n── ${name} (${ms.toFixed(0)}ms) ─────────────────────────`);
  let total = 0;
  for (const [u, s] of stats) {
    total += s.bytes;
    console.log(`  ${fmtBytes(s.bytes).padStart(10)}  ${String(s.requests).padStart(3)} req  ${u}`);
    if (opts.showRanges) {
      const sizes = s.ranges.map((r) => {
        if (!r || r === "HEAD") return -1;
        const [a, b] = r.split("-").map(Number);
        return b - a + 1;
      }).filter((x) => x >= 0);
      sizes.sort((a, b) => b - a);
      console.log(`    all ranges (desc): ${sizes.map((s) => s === -1 ? "FULL" : fmtBytes(s)).join(", ")}`);
      const sum = sizes.reduce((a, b) => a + (b === -1 ? 0 : b), 0);
      console.log(`    sum of ranges: ${fmtBytes(sum)}  vs bytes counted: ${fmtBytes(s.bytes)}`);
    }
  }
  console.log(`  ${fmtBytes(total).padStart(10)}  TOTAL`);
}

const YEARS = [2020, 2021, 2022, 2023, 2024, 2025, 2026];
function urlsFor(table: string, years: number[] = YEARS): string {
  // DuckDB read_parquet takes a list literal of URLs.
  const list = years
    .map((y) => `'http://127.0.0.1:${PORT}/07/${table}/year=${y}/data_0.parquet'`)
    .join(", ");
  return `[${list}]`;
}
const URL_OBJ = urlsFor("objects");
const URL_EXP = urlsFor("expenses");
const URL_OBJ_2026 = urlsFor("objects", [2026]);
const URL_EXP_2026 = urlsFor("expenses", [2026]);

const db = await DuckDBInstance.create(":memory:");
const conn = await db.connect();
await conn.run("INSTALL httpfs;");
await conn.run("LOAD httpfs;");
await conn.run("SET allow_asterisks_in_http_paths = true;");

await measure("Q1: top 10 objects in 2026  (single year file)", async () => {
  const r = await conn.runAndReadAll(
    `SELECT code, LEFT(description, 50) AS description, amount
     FROM read_parquet(${URL_OBJ_2026}, hive_partitioning = true)
     ORDER BY amount DESC NULLS LAST LIMIT 10`,
  );
  console.log("  sample row:", r.getRows()[0]);
}, { showRanges: true });

await measure("Q2: yearly trend (all 7 year files)", async () => {
  const r = await conn.runAndReadAll(
    `SELECT year, SUM(amount) AS total
     FROM read_parquet(${URL_OBJ}, hive_partitioning = true) GROUP BY year ORDER BY year`,
  );
  console.log("  row count:", r.getRows().length);
});

await measure("Q3: expense class breakdown 2026 (single file)", async () => {
  const r = await conn.runAndReadAll(
    `SELECT LEFT(code, 1) AS class, SUM(amount) AS total
     FROM read_parquet(${URL_EXP_2026}, hive_partitioning = true)
     WHERE code IS NOT NULL GROUP BY class ORDER BY total DESC`,
  );
  console.log("  row count:", r.getRows().length);
});

await measure("Q4: count distinct agencies in objects (all years)", async () => {
  const r = await conn.runAndReadAll(
    `SELECT COUNT(DISTINCT agency_id) AS n FROM read_parquet(${URL_OBJ}, hive_partitioning = true)`,
  );
  console.log("  result:", r.getRows()[0]);
});

await measure("Q5: filter by agency + year (high selectivity)", async () => {
  const r = await conn.runAndReadAll(
    `SELECT code, description, amount FROM read_parquet(${URL_OBJ_2026}, hive_partitioning = true)
     WHERE agency_id = '07-001'
     ORDER BY amount DESC LIMIT 20`,
  );
  console.log("  row count:", r.getRows().length);
});

server.close();
process.exit(0);
