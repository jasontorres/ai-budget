/**
 * Delete the heavy JSONs from R2 now that the Portal queries parquet.
 *
 * Removes per-dept:
 *   objects.json, expenses.json, fpaps.json, operating_units.json,
 *   fund_subcategories.json
 *
 * Keeps:
 *   departments.json, agencies.json, yearly_totals.json   (Stage A)
 *   parquet_manifest.json                                  (parquet index)
 *   {table}/year=YYYY/data_0.parquet                       (the data)
 *   national/index.json                                    (national rollup)
 *
 * Run:
 *   npm run cleanup:r2 -- --dry-run   # list what'd be deleted
 *   npm run cleanup:r2                # actually delete
 */
import {
  S3Client,
  DeleteObjectsCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";

const HEAVY_JSONS = [
  "objects.json",
  "expenses.json",
  "fpaps.json",
  "operating_units.json",
  "fund_subcategories.json",
];

const accountId = process.env.R2_ACCOUNT_ID;
const accessKeyId = process.env.R2_ACCESS_KEY_ID;
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
const Bucket = process.env.R2_BUCKET || "budget";

if (!accountId || !accessKeyId || !secretAccessKey) {
  console.error("Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY in .env");
  process.exit(1);
}

const s3 = new S3Client({
  region: "auto",
  endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId, secretAccessKey },
});

async function exists(key: string): Promise<{ exists: boolean; size: number }> {
  try {
    const head = await s3.send(new HeadObjectCommand({ Bucket, Key: key }));
    return { exists: true, size: Number(head.ContentLength || 0) };
  } catch {
    return { exists: false, size: 0 };
  }
}

function fmtBytes(n: number): string {
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 ** 2).toFixed(2)} MB`;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const depts: string[] = [];
  for (let i = 1; i <= 40; i++) depts.push(String(i).padStart(2, "0"));

  console.log(`Bucket: ${Bucket}`);
  console.log(`Mode:   ${dryRun ? "DRY RUN" : "DELETE"}`);
  console.log("─".repeat(72));

  const toDelete: { Key: string; size: number }[] = [];
  for (const dept of depts) {
    for (const name of HEAVY_JSONS) {
      const Key = `${dept}/${name}`;
      const r = await exists(Key);
      if (r.exists) toDelete.push({ Key, size: r.size });
    }
  }

  let totalBytes = 0;
  for (const o of toDelete) {
    totalBytes += o.size;
    console.log(`  ${dryRun ? "DRY  " : "DELETE"}  ${fmtBytes(o.size).padStart(10)}  ${o.Key}`);
  }

  if (!dryRun && toDelete.length > 0) {
    // R2 supports DeleteObjects in batches of 1000.
    for (let i = 0; i < toDelete.length; i += 1000) {
      const batch = toDelete.slice(i, i + 1000).map(({ Key }) => ({ Key }));
      await s3.send(
        new DeleteObjectsCommand({
          Bucket,
          Delete: { Objects: batch, Quiet: true },
        }),
      );
    }
  }

  console.log("─".repeat(72));
  console.log(
    `${dryRun ? "DRY " : ""}${toDelete.length} files, ${fmtBytes(totalBytes)} reclaimed`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
