/**
 * /explore — DuckDB-WASM lazy-loading proof.
 *
 * Runs three representative queries against dept 07's Hive-partitioned parquet
 * tree and reports query time, row counts, and bytes pulled over HTTP. The
 * point of this page: a 786MB JSON tree becomes ~145MB of parquet on disk and
 * single-digit MB per query on the wire.
 */
import { useEffect, useState } from "react";
import { loadManifest, parquetUrls, runQuery, type ParquetManifest } from "../lib/duckdb";
import * as fmt from "../lib/format";
import SiteHeader from "../components/SiteHeader";
import SiteFooter from "../components/SiteFooter";
import { Eyebrow, SectionHead } from "../components/shared";

interface QueryRun {
  label: string;
  sql: string;
  rows: Array<Record<string, unknown>>;
  ms: number;
  bytesTransferred: number;
  bytesEncoded: number;
  urls: string[];
}

const SCALE = 1000; // matches dept-data.ts: parquet stores amounts in thousands.
const DEPT = "07";

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 ** 2).toFixed(2)} MB`;
}

function bytesFor(urls: ReadonlyArray<string>): { transferred: number; encoded: number } {
  const set = new Set(urls);
  const entries = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
  let t = 0;
  let e = 0;
  for (const r of entries) {
    if (set.has(r.name)) {
      t += r.transferSize || 0;
      e += r.encodedBodySize || 0;
    }
  }
  return { transferred: t, encoded: e };
}

function urlsFromList(literal: string): string[] {
  return literal
    .replace(/^\[|\]$/g, "")
    .split(",")
    .map((s) => s.trim().replace(/^'|'$/g, ""))
    .filter(Boolean);
}

export default function Explore() {
  const [runs, setRuns] = useState<QueryRun[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [stage, setStage] = useState<string>("initializing duckdb-wasm…");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setStage("loading parquet manifest");
        const manifest: ParquetManifest = await loadManifest(DEPT);

        const queries: Array<{ label: string; sql: () => string }> = [
          {
            label: "Top 10 spending objects in 2026 (year=2026 only)",
            sql: () => {
              const urls = parquetUrls(DEPT, "objects", manifest, [2026]);
              return `
                SELECT code, description, agency_id,
                       CAST(amount * ${SCALE} AS BIGINT) AS pesos
                FROM read_parquet(${urls}, hive_partitioning = true)
                ORDER BY amount DESC NULLS LAST
                LIMIT 10`;
            },
          },
          {
            label: "Yearly trend across 2020–2026 (scans all year partitions)",
            sql: () => {
              const urls = parquetUrls(DEPT, "objects", manifest);
              return `
                SELECT year,
                       CAST(SUM(amount) * ${SCALE} AS BIGINT) AS pesos,
                       COUNT(*) AS row_count
                FROM read_parquet(${urls}, hive_partitioning = true)
                GROUP BY year ORDER BY year`;
            },
          },
          {
            label: "Expense-class breakdown for 2026 (different table)",
            sql: () => {
              const urls = parquetUrls(DEPT, "expenses", manifest, [2026]);
              return `
                SELECT LEFT(code, 1) AS class,
                       CAST(SUM(amount) * ${SCALE} AS BIGINT) AS pesos,
                       COUNT(*) AS row_count
                FROM read_parquet(${urls}, hive_partitioning = true)
                WHERE code IS NOT NULL
                GROUP BY class
                ORDER BY pesos DESC`;
            },
          },
          {
            label: "Drill-in: top objects for one agency in 2026",
            sql: () => {
              const urls = parquetUrls(DEPT, "objects", manifest, [2026]);
              return `
                SELECT code, description,
                       CAST(amount * ${SCALE} AS BIGINT) AS pesos
                FROM read_parquet(${urls}, hive_partitioning = true)
                WHERE agency_id = '07-001'
                ORDER BY amount DESC NULLS LAST
                LIMIT 10`;
            },
          },
        ];

        const out: QueryRun[] = [];
        for (const q of queries) {
          if (cancelled) return;
          setStage(`running: ${q.label}`);
          const sql = q.sql();
          const urls = urlsFromList(sql.match(/read_parquet\((\[[^\]]+\])/)![1]);
          const before = bytesFor(urls);
          const { rows, ms } = await runQuery<Record<string, unknown>>(sql);
          const after = bytesFor(urls);
          out.push({
            label: q.label,
            sql,
            rows: rows.slice(0, 10),
            ms,
            bytesTransferred: after.transferred - before.transferred,
            bytesEncoded: after.encoded - before.encoded,
            urls,
          });
          if (!cancelled) setRuns([...out]);
        }
        if (!cancelled) setStage("done");
      } catch (e) {
        if (!cancelled) {
          setErr(String((e as Error).message || e));
          setStage("error");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <>
      <SiteHeader />
      <main style={{ maxWidth: 1100, margin: "60px auto", padding: "0 32px" }}>
        <Eyebrow>experiment · duckdb-wasm</Eyebrow>
        <SectionHead headline="Lazy-loading via Parquet + HTTP Range" />
        <p style={{ color: "var(--ink-3)", fontFamily: "var(--font-body)", maxWidth: 720, lineHeight: 1.6 }}>
          Dept 07 (DepEd) JSON tree weighs 786 MB and locks the browser on
          fetch. Converted to year-partitioned Parquet it occupies 145 MB on
          disk — and each query below pulls only the columns + row groups it
          actually needs. The transferred/encoded byte counts come straight
          from the PerformanceResourceTiming API.
        </p>

        <div
          style={{
            marginTop: 32,
            padding: "12px 16px",
            border: "1px solid var(--rule)",
            background: "var(--paper-2)",
            fontFamily: "var(--font-mono)",
            fontSize: 12,
            color: "var(--ink-2)",
          }}
        >
          status: {stage}
          {err && <div style={{ color: "var(--accent)", marginTop: 6 }}>{err}</div>}
        </div>

        {runs.map((r, i) => (
          <section key={i} style={{ marginTop: 40 }}>
            <h3
              style={{
                margin: "0 0 8px",
                fontFamily: "var(--font-mono)",
                fontSize: 12,
                letterSpacing: 0.5,
                textTransform: "uppercase",
                color: "var(--ink-2)",
              }}
            >
              Q{i + 1} · {r.label}
            </h3>
            <pre
              style={{
                background: "var(--paper-2)",
                border: "1px solid var(--rule)",
                padding: "10px 12px",
                fontFamily: "var(--font-mono)",
                fontSize: 11,
                overflowX: "auto",
                margin: 0,
                whiteSpace: "pre-wrap",
              }}
            >
              {r.sql.trim()}
            </pre>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr 1fr 1fr",
                gap: 8,
                marginTop: 8,
              }}
            >
              <Stat label="query time" value={`${r.ms.toFixed(1)} ms`} />
              <Stat label="bytes transferred" value={fmtBytes(r.bytesTransferred)} />
              <Stat label="bytes encoded" value={fmtBytes(r.bytesEncoded)} />
              <Stat label="files touched" value={String(r.urls.length)} />
            </div>
            {r.rows.length > 0 && (
              <table
                style={{
                  marginTop: 12,
                  width: "100%",
                  borderCollapse: "collapse",
                  fontFamily: "var(--font-mono)",
                  fontSize: 12,
                }}
              >
                <thead>
                  <tr>
                    {Object.keys(r.rows[0]).map((k) => (
                      <th
                        key={k}
                        style={{
                          textAlign: "left",
                          borderBottom: "1px solid var(--rule)",
                          padding: "6px 8px",
                          color: "var(--ink-2)",
                        }}
                      >
                        {k}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {r.rows.map((row, j) => (
                    <tr key={j}>
                      {Object.entries(row).map(([k, v]) => (
                        <td
                          key={k}
                          style={{
                            borderBottom: "1px solid var(--rule)",
                            padding: "6px 8px",
                            color: "var(--ink-1)",
                          }}
                        >
                          {renderCell(k, v)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        ))}
      </main>
      <SiteFooter />
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        border: "1px solid var(--rule)",
        padding: "8px 10px",
        background: "var(--paper)",
      }}
    >
      <div style={{ color: "var(--ink-3)", fontSize: 10, textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</div>
      <div style={{ color: "var(--ink-1)", fontSize: 14, marginTop: 2 }}>{value}</div>
    </div>
  );
}

function renderCell(key: string, v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "bigint") {
    if (/pesos|amount/.test(key)) return fmt.php(Number(v));
    return v.toString();
  }
  if (typeof v === "number" && /pesos|amount/.test(key)) return fmt.php(v);
  return String(v);
}
