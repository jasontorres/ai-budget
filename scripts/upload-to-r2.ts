/**
 * Upload converted parquet tree + manifests to Cloudflare R2.
 *
 * R2 is S3-compatible. Required env vars:
 *   R2_ACCOUNT_ID         BetterGov account ID (cd41...ff6)
 *   R2_ACCESS_KEY_ID      from Cloudflare dashboard → R2 → Manage API tokens
 *   R2_SECRET_ACCESS_KEY  ditto
 *   R2_BUCKET             defaults to "gaa-parquet"
 *
 * Usage:
 *   npm run upload:r2 -- --dept=07            # one dept
 *   npm run upload:r2 -- --all                # everything
 *   npm run upload:r2 -- --all --dry-run      # list only
 *
 * Layout in the bucket mirrors the local data/ tree:
 *   {deptId}/departments.json         (Stage A core)
 *   {deptId}/agencies.json            (Stage A core)
 *   {deptId}/yearly_totals.json       (Stage A core)
 *   {deptId}/parquet_manifest.json    (parquet index)
 *   {deptId}/{table}/year=YYYY/data_0.parquet
 *   national/index.json               (national rollup)
 *
 * Parallelism is bounded so a 145 MB dept doesn't fan out to dozens of
 * concurrent multipart uploads.
 */
import { S3Client, HeadObjectCommand } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { createReadStream, existsSync, readdirSync, statSync } from "node:fs";
import { resolve, relative, sep } from "node:path";

const accountId = process.env.R2_ACCOUNT_ID;
const accessKeyId = process.env.R2_ACCESS_KEY_ID;
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
const Bucket = process.env.R2_BUCKET || "budget";

if (!accountId || !accessKeyId || !secretAccessKey) {
  console.error(
    "Missing R2 credentials. Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY.\n" +
      "  Account: BetterGov (cd41784b73cc20f93b3137292f818ff6)\n" +
      "  Create tokens: Cloudflare dashboard → R2 → Manage API tokens → Create token (Object R/W on bucket)",
  );
  process.exit(1);
}

const endpoint = `https://${accountId}.r2.cloudflarestorage.com`;
const s3 = new S3Client({
  region: "auto",
  endpoint,
  credentials: { accessKeyId, secretAccessKey },
});

interface Args {
  all: boolean;
  dept?: string;
  dryRun: boolean;
  force: boolean;
  concurrency: number;
}
function parseArgs(): Args {
  const args = process.argv.slice(2);
  const get = (k: string) => args.find((a) => a.startsWith(`--${k}=`))?.split("=")[1];
  return {
    all: args.includes("--all"),
    dept: get("dept"),
    dryRun: args.includes("--dry-run"),
    force: args.includes("--force"),
    concurrency: Number(get("concurrency") || "6"),
  };
}

function listDepts(dataRoot: string): string[] {
  return readdirSync(dataRoot)
    .filter((d) => /^\d{2}$/.test(d))
    .filter((d) => statSync(resolve(dataRoot, d)).isDirectory())
    .sort();
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = resolve(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 ** 2).toFixed(2)} MB`;
}

function contentTypeFor(path: string): string {
  if (path.endsWith(".parquet")) return "application/vnd.apache.parquet";
  if (path.endsWith(".json")) return "application/json";
  return "application/octet-stream";
}

async function alreadyUploaded(key: string, size: number): Promise<boolean> {
  try {
    const head = await s3.send(new HeadObjectCommand({ Bucket, Key: key }));
    return Number(head.ContentLength || 0) === size;
  } catch {
    return false;
  }
}

async function uploadOne(localPath: string, key: string, opts: { force: boolean; dryRun: boolean }): Promise<{ skipped: boolean; bytes: number; ms: number }> {
  const size = statSync(localPath).size;
  if (opts.dryRun) return { skipped: false, bytes: size, ms: 0 };
  if (!opts.force && (await alreadyUploaded(key, size))) {
    return { skipped: true, bytes: size, ms: 0 };
  }
  const t0 = performance.now();
  const upload = new Upload({
    client: s3,
    params: {
      Bucket,
      Key: key,
      Body: createReadStream(localPath),
      ContentType: contentTypeFor(localPath),
      ContentLength: size,
      CacheControl: "public, max-age=31536000, immutable",
    },
    queueSize: 4,
    partSize: 16 * 1024 * 1024,
  });
  await upload.done();
  return { skipped: false, bytes: size, ms: performance.now() - t0 };
}

async function uploadDept(deptId: string, dataRoot: string, opts: Args) {
  const deptRoot = resolve(dataRoot, deptId);
  const items: { local: string; key: string }[] = [];

  // All JSON files at the dept root: small Stage A bundles + heavy Stage B/C
  // sources (fpaps, operating_units, fund_subcategories, expenses, objects)
  // + parquet manifest. Keeps the existing dept-data.ts loader working
  // against R2 unchanged.
  for (const name of readdirSync(deptRoot)) {
    if (!name.endsWith(".json")) continue;
    const p = resolve(deptRoot, name);
    if (statSync(p).isFile()) items.push({ local: p, key: `${deptId}/${name}` });
  }

  // Parquet tree (Hive-partitioned per year)
  for (const name of readdirSync(deptRoot)) {
    const subdir = resolve(deptRoot, name);
    if (!statSync(subdir).isDirectory()) continue;
    if (!/^(objects|expenses|fund_subcategories|operating_units|fpaps)$/.test(name)) continue;
    for (const f of walk(subdir)) {
      if (!f.endsWith(".parquet")) continue;
      const key = relative(dataRoot, f).split(sep).join("/");
      items.push({ local: f, key });
    }
  }

  if (items.length === 0) {
    console.log(`  ${deptId}: no parquet tree (run build:parquet first)`);
    return { uploaded: 0, skipped: 0, bytes: 0 };
  }

  let uploaded = 0;
  let skipped = 0;
  let bytes = 0;
  let inFlight = 0;
  let cursor = 0;

  const runOne = async () => {
    while (cursor < items.length) {
      const idx = cursor++;
      const { local, key } = items[idx];
      try {
        const r = await uploadOne(local, key, { force: opts.force, dryRun: opts.dryRun });
        if (r.skipped) {
          skipped++;
          process.stdout.write(
            `  ${deptId}  [${String(idx + 1).padStart(3)}/${items.length}] skip ${key}\n`,
          );
        } else {
          uploaded++;
          bytes += r.bytes;
          process.stdout.write(
            `  ${deptId}  [${String(idx + 1).padStart(3)}/${items.length}] ${opts.dryRun ? "DRY" : "PUT"}  ${fmtBytes(r.bytes).padStart(8)}  ${r.ms ? (r.ms / 1000).toFixed(1) + "s" : ""}  ${key}\n`,
          );
        }
      } catch (e) {
        process.stdout.write(`  ${deptId}  ERROR ${key}: ${(e as Error).message}\n`);
        throw e;
      }
    }
  };

  inFlight = Math.min(opts.concurrency, items.length);
  await Promise.all(Array.from({ length: inFlight }, runOne));
  return { uploaded, skipped, bytes };
}

async function uploadNational(dataRoot: string, opts: Args) {
  const nationalDir = resolve(dataRoot, "national");
  if (!existsSync(nationalDir)) return { uploaded: 0, skipped: 0, bytes: 0 };
  let uploaded = 0;
  let skipped = 0;
  let bytes = 0;
  for (const f of walk(nationalDir)) {
    if (!f.endsWith(".json")) continue;
    const key = relative(dataRoot, f).split(sep).join("/");
    try {
      const r = await uploadOne(f, key, { force: opts.force, dryRun: opts.dryRun });
      if (r.skipped) {
        skipped++;
        process.stdout.write(`  national  skip ${key}\n`);
      } else {
        uploaded++;
        bytes += r.bytes;
        process.stdout.write(
          `  national  ${opts.dryRun ? "DRY" : "PUT"}  ${fmtBytes(r.bytes).padStart(8)}  ${r.ms ? (r.ms / 1000).toFixed(1) + "s" : ""}  ${key}\n`,
        );
      }
    } catch (e) {
      process.stdout.write(`  national  ERROR ${key}: ${(e as Error).message}\n`);
      throw e;
    }
  }
  return { uploaded, skipped, bytes };
}

async function main() {
  const opts = parseArgs();
  const dataRoot = resolve(process.cwd(), "data");
  const depts = opts.all
    ? listDepts(dataRoot)
    : opts.dept
      ? [opts.dept]
      : (() => {
          console.error("usage: npm run upload:r2 -- --dept=NN | --all  [--dry-run] [--force] [--concurrency=6]");
          process.exit(1);
        })();

  console.log(`Endpoint: ${endpoint}`);
  console.log(`Bucket:   ${Bucket}`);
  console.log(`Depts:    ${depts.join(", ")}`);
  console.log(`Mode:     ${opts.dryRun ? "DRY RUN" : opts.force ? "force-overwrite" : "skip identical"}`);
  console.log("─".repeat(72));

  let totUploaded = 0;
  let totSkipped = 0;
  let totBytes = 0;
  const t0 = performance.now();
  for (const deptId of depts) {
    const r = await uploadDept(deptId, dataRoot, opts);
    totUploaded += r.uploaded;
    totSkipped += r.skipped;
    totBytes += r.bytes;
  }
  // Upload national rollup whenever we touch --all (a single dept doesn't need it).
  if (opts.all) {
    const r = await uploadNational(dataRoot, opts);
    totUploaded += r.uploaded;
    totSkipped += r.skipped;
    totBytes += r.bytes;
  }
  const ms = performance.now() - t0;
  console.log("─".repeat(72));
  console.log(
    `${opts.dryRun ? "DRY " : ""}${totUploaded} uploaded, ${totSkipped} skipped, ${fmtBytes(totBytes)} total in ${(ms / 1000).toFixed(1)}s`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
