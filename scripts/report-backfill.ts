// PR-2.2 (.mjs → .ts at PR-2.2-mech.3): post-run reporter for INITIAL_BACKFILL.
//
// Generates six artifacts in .pr-2-2-artifacts/:
//   1. run-summary.txt
//   2. vocab-gap-distribution.txt
//   3. cost-reconciliation.txt
//   4. rule-coverage.txt
//   5. cost-histogram.txt
//   6. sample-audit.txt
//
// Read-only — does not mutate any state. Safe to run multiple times.
//
// Usage:
//   npx tsx scripts/report-backfill.ts --shop <shopDomain> [--job-id <id>]
//
// Why .ts (PR-2.2-mech.3): the previous .mjs version had hand-mirrored
// copies of STARTER_AXES + AXIS_OPTIONS.FASHION which silently went
// stale when PR-2.2-mech.1 added sustainability + season axes to the
// TS source-of-truth. The mech.3 conversion makes the reporter import
// directly from app/lib/catalog/store-axes + axis-options via tsx,
// eliminating the manual-sync class of drift. The exported
// classifyTagPair helper at the bottom of this file is the public
// vocab-classification surface tested in scripts/report-backfill.test.ts.

import "dotenv/config";
import pg from "pg";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { STARTER_AXES } from "../app/lib/catalog/store-axes";
import { AXIS_OPTIONS } from "../app/lib/catalog/axis-options";
import type { StoreMode } from "../app/lib/catalog/store-axes-types";

const { Client } = pg;
const ARTIFACTS_DIR = ".pr-2-2-artifacts";

// ---- Vocabulary classification --------------------------------------------
//
// The reporter's notion of "in-vocabulary" derives from the same
// constants the AI prompt construction uses (STARTER_AXES via
// Object.keys(AXIS_OPTIONS) — see PR-2.2-mech.1's confirmation of
// data-driven prompt construction). Single source of truth.

export type TagClassification =
  | { kind: "axis-not-in-vocab"; axis: string; value: string }
  | { kind: "free-form-allowed"; axis: string; value: string }
  | { kind: "in-vocab"; axis: string; value: string }
  | { kind: "out-of-vocab"; axis: string; value: string };

/**
 * Classify a single AI-proposed (axis, value) pair against the mode's
 * STARTER_AXES + AXIS_OPTIONS vocabulary.
 *
 *   axis-not-in-vocab    — axis is not in STARTER_AXES[mode]
 *   free-form-allowed    — axis IS in vocab, but its type is "text"
 *                          (any value is accepted)
 *   in-vocab             — axis + value both in vocab
 *   out-of-vocab         — axis is in vocab but value is not in the enum
 */
export function classifyTagPair(
  axis: string,
  value: string,
  mode: StoreMode,
): TagClassification {
  const knownAxes = STARTER_AXES[mode] ?? [];
  if (!knownAxes.includes(axis)) {
    return { kind: "axis-not-in-vocab", axis, value };
  }
  const axisDef = AXIS_OPTIONS[mode]?.[axis];
  if (!axisDef || axisDef.type === "text") {
    return { kind: "free-form-allowed", axis, value };
  }
  if (axisDef.values.includes(value)) {
    return { kind: "in-vocab", axis, value };
  }
  return { kind: "out-of-vocab", axis, value };
}

// ---- Internal types -------------------------------------------------------

type Args = { shop: string | null; jobId: string | null };

type TaggingJobRow = {
  id: string;
  shopDomain: string;
  productId: string | null;
  kind: string;
  status: string;
  triggerSource: string;
  enqueuedAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
  heartbeatAt: Date | null;
  totalProducts: number | null;
  processedProducts: number;
  failedProducts: number;
  skippedProducts: number;
  costUsdMicros: bigint | string | number;
  inputTokens: number;
  outputTokens: number;
  errorClass: string | null;
  errorMessage: string | null;
  summary: Record<string, unknown> | null;
};

type TagRow = {
  axis: string;
  value: string;
  confidence: number | null;
  source: string;
  status: string;
  productId: string;
  p_id: string;
  shopifyId: string;
  title: string | null;
  productType: string | null;
  vendor: string | null;
  desc_len: number;
  descriptionHtml: string | null;
};

type ProductBucket = {
  productId: string;
  shopifyId: string;
  title: string | null;
  productType: string | null;
  vendor: string | null;
  descLen: number;
  descriptionHtml: string | null;
  tags: TagRow[];
};

// ---- Helpers --------------------------------------------------------------

function parseArgs(argv: string[]): Args {
  const args: Args = { shop: null, jobId: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--shop") args.shop = argv[++i] ?? null;
    else if (argv[i] === "--job-id") args.jobId = argv[++i] ?? null;
    else if (argv[i] === "--help" || argv[i] === "-h") {
      // eslint-disable-next-line no-console
      console.log(
        `Usage: npx tsx scripts/report-backfill.ts --shop <shopDomain> [--job-id <id>]`,
      );
      process.exit(0);
    }
  }
  return args;
}

function die(msg: string): never {
  // eslint-disable-next-line no-console
  console.error(`ERROR: ${msg}`);
  process.exit(1);
}

function ensureDir(path: string): void {
  mkdirSync(dirname(path), { recursive: true });
}

function microsToUsd(micros: bigint | number): number {
  return Number(micros) / 1_000_000;
}

function pct(num: number, den: number): string {
  return den > 0 ? ((num / den) * 100).toFixed(1) : "0.0";
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * p));
  return sorted[idx];
}

function asciiBar(count: number, scale: number, width = 50): string {
  const filled = Math.min(width, Math.round((count / scale) * width));
  return "█".repeat(filled) + " ".repeat(width - filled);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.shop) die("--shop is required.");

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  // Locate the INITIAL_BACKFILL row.
  const jobRes = args.jobId
    ? await client.query<TaggingJobRow>(`SELECT * FROM "TaggingJob" WHERE id = $1`, [args.jobId])
    : await client.query<TaggingJobRow>(
        `SELECT * FROM "TaggingJob"
         WHERE "shopDomain" = $1 AND kind = 'INITIAL_BACKFILL'
         ORDER BY "enqueuedAt" DESC LIMIT 1`,
        [args.shop],
      );
  if (jobRes.rows.length === 0) {
    await client.end();
    die(
      `No INITIAL_BACKFILL TaggingJob found for shop "${args.shop}"${args.jobId ? ` with id ${args.jobId}` : ""}.`,
    );
  }
  const job = jobRes.rows[0];
  if (!["SUCCEEDED", "FAILED", "BUDGET_PAUSED", "CANCELLED"].includes(job.status)) {
    await client.end();
    // eslint-disable-next-line no-console
    console.error(
      `Job ${job.id} is still ${job.status}. Wait for the worker to drain or kill it manually before reporting.`,
    );
    process.exit(2);
  }

  // Get shop mode for vocabulary lookup.
  const cfgRes = await client.query<{ storeMode: StoreMode }>(
    `SELECT "storeMode" FROM "MerchantConfig" WHERE shop = $1`,
    [args.shop],
  );
  const mode: StoreMode = cfgRes.rows[0]?.storeMode ?? "GENERAL";

  const startedAtIso = job.startedAt?.toISOString();
  const tagsRes = await client.query<TagRow>(
    `SELECT pt.*, p.id AS "p_id", p."shopifyId", p.title, p."productType",
            p.vendor, length(coalesce(p."descriptionHtml", ''))::int AS desc_len,
            p."descriptionHtml"
     FROM "ProductTag" pt
     JOIN "Product" p ON p.id = pt."productId"
     WHERE pt."shopDomain" = $1 AND pt.source = 'AI' AND pt."createdAt" >= $2::timestamptz
     ORDER BY pt."createdAt" ASC`,
    [args.shop, startedAtIso],
  );

  const ruleTagsRes = await client.query<TagRow>(
    `SELECT pt.*, p.id AS "p_id"
     FROM "ProductTag" pt
     JOIN "Product" p ON p.id = pt."productId"
     WHERE pt."shopDomain" = $1 AND pt.source = 'RULE' AND pt."createdAt" >= $2::timestamptz`,
    [args.shop, startedAtIso],
  );

  const byProduct = new Map<string, ProductBucket>();
  for (const t of tagsRes.rows) {
    const key = t.p_id;
    if (!byProduct.has(key)) {
      byProduct.set(key, {
        productId: t.p_id,
        shopifyId: t.shopifyId,
        title: t.title,
        productType: t.productType,
        vendor: t.vendor,
        descLen: t.desc_len,
        descriptionHtml: t.descriptionHtml,
        tags: [],
      });
    }
    byProduct.get(key)!.tags.push(t);
  }

  const totalProducts = job.totalProducts ?? 0;
  const processed = job.processedProducts ?? 0;
  const failed = job.failedProducts ?? 0;
  const totalCostMicros = BigInt((job.costUsdMicros as bigint | string | number) ?? 0);
  const totalCostUsd = microsToUsd(totalCostMicros);
  const summary = job.summary ?? {};

  writeArtifact(
    "run-summary.txt",
    renderRunSummary({
      job, mode, totalProducts, processed, failed,
      totalCostMicros, totalCostUsd, summary, productCount: byProduct.size,
    }),
  );

  writeArtifact(
    "vocab-gap-distribution.txt",
    renderVocabGap({ tagsRes, mode, productCount: byProduct.size }),
  );

  writeArtifact(
    "cost-reconciliation.txt",
    renderCostReconciliation({ job, summary, totalCostUsd, totalCostMicros }),
  );

  writeArtifact(
    "rule-coverage.txt",
    renderRuleCoverage({ ruleTagsRes, aiTagsRes: tagsRes, productCount: byProduct.size }),
  );

  writeArtifact(
    "cost-histogram.txt",
    renderCostHistogram({ byProduct, totalCostUsd }),
  );

  writeArtifact(
    "sample-audit.txt",
    renderSampleAudit({ byProduct, productCount: byProduct.size, mode }),
  );

  // eslint-disable-next-line no-console
  console.log(`Reporter generated 6 artifacts in ${ARTIFACTS_DIR}/:`);
  for (const name of [
    "run-summary.txt",
    "vocab-gap-distribution.txt",
    "cost-reconciliation.txt",
    "rule-coverage.txt",
    "cost-histogram.txt",
    "sample-audit.txt",
  ]) {
    // eslint-disable-next-line no-console
    console.log(`  ${name}`);
  }

  await client.end();
}

function writeArtifact(name: string, content: string): void {
  const path = `${ARTIFACTS_DIR}/${name}`;
  ensureDir(path);
  writeFileSync(path, content);
}

// ---- Renderers ------------------------------------------------------------

function renderRunSummary(p: {
  job: TaggingJobRow;
  mode: StoreMode;
  totalProducts: number;
  processed: number;
  failed: number;
  totalCostMicros: bigint;
  totalCostUsd: number;
  summary: Record<string, unknown>;
  productCount: number;
}): string {
  const { job, mode, totalProducts, processed, failed, totalCostMicros, totalCostUsd, summary, productCount } = p;
  const success = totalProducts > 0 ? pct(processed, totalProducts) : "—";
  const errorCounts = (summary.errorCounts ?? {}) as Record<string, number | undefined>;
  const startMs = job.startedAt ? new Date(job.startedAt).getTime() : 0;
  const endMs = job.finishedAt ? new Date(job.finishedAt).getTime() : 0;
  const durationMin = endMs > 0 && startMs > 0 ? ((endMs - startMs) / 1000 / 60).toFixed(1) : "—";

  const meanUsd = processed > 0 ? totalCostUsd / processed : 0;
  const note = processed > 0
    ? `Approximate per-product stats derived from total cost / processed count.\n` +
      `(Per-product cost not stored individually; future iterations may add it.)`
    : "No products processed.";

  return [
    `INITIAL_BACKFILL run summary`,
    `Generated: ${new Date().toISOString()}`,
    `Shop:      ${job.shopDomain}  (mode: ${mode})`,
    `Job:       ${job.id}`,
    `Status:    ${job.status}`,
    "",
    "----------------------------------------",
    `Total products attempted:    ${totalProducts}`,
    `Processed (succeeded):       ${processed}  (${success}%)`,
    `Failed:                      ${failed}`,
    `Distinct products tagged:    ${productCount}`,
    "----------------------------------------",
    `Total cost (microdollars):   ${totalCostMicros.toString()}`,
    `Total cost (USD):            $${totalCostUsd.toFixed(4)}`,
    `Mean cost per processed:     $${meanUsd.toFixed(6)}`,
    `Total input tokens:          ${job.inputTokens ?? 0}`,
    `Total output tokens:         ${job.outputTokens ?? 0}`,
    "----------------------------------------",
    `Wall-clock duration:         ${durationMin} min`,
    `Started:                     ${job.startedAt?.toISOString() ?? "—"}`,
    `Finished:                    ${job.finishedAt?.toISOString() ?? "—"}`,
    "----------------------------------------",
    `Anthropic error class counts:`,
    `  RATE_LIMIT:     ${errorCounts.RATE_LIMIT ?? 0}`,
    `  AUTH:           ${errorCounts.AUTH ?? 0}`,
    `  MALFORMED_JSON: ${errorCounts.MALFORMED_JSON ?? 0}`,
    `  CONNECTION:     ${errorCounts.CONNECTION ?? 0}`,
    `  OTHER:          ${errorCounts.OTHER ?? 0}`,
    "",
    note,
    "",
  ].join("\n");
}

function renderVocabGap(p: {
  tagsRes: pg.QueryResult<TagRow>;
  mode: StoreMode;
  productCount: number;
}): string {
  const { tagsRes, mode, productCount } = p;
  const total = tagsRes.rows.length;
  let inVocabAxis = 0, oovAxis = 0;
  let inVocabValue = 0, oovValue = 0, freeFormValue = 0;
  const oovAxisCounts = new Map<string, number>();
  const oovValueCountsByAxis = new Map<string, Map<string, number>>();
  const newAxisProducts = new Map<string, Set<string>>();

  for (const t of tagsRes.rows) {
    const c = classifyTagPair(t.axis, t.value, mode);
    switch (c.kind) {
      case "axis-not-in-vocab":
        oovAxis++;
        oovAxisCounts.set(t.axis, (oovAxisCounts.get(t.axis) ?? 0) + 1);
        if (!newAxisProducts.has(t.axis)) newAxisProducts.set(t.axis, new Set());
        newAxisProducts.get(t.axis)!.add(t.productId);
        break;
      case "free-form-allowed":
        inVocabAxis++;
        freeFormValue++;
        break;
      case "in-vocab":
        inVocabAxis++;
        inVocabValue++;
        break;
      case "out-of-vocab": {
        inVocabAxis++;
        oovValue++;
        if (!oovValueCountsByAxis.has(t.axis)) oovValueCountsByAxis.set(t.axis, new Map());
        const m = oovValueCountsByAxis.get(t.axis)!;
        m.set(t.value, (m.get(t.value) ?? 0) + 1);
        break;
      }
    }
  }

  const lines: string[] = [
    `Vocabulary gap distribution`,
    `Generated: ${new Date().toISOString()}`,
    `Mode:      ${mode}`,
    "",
    `Total (axis, value) pairs proposed:        ${total}`,
    `In-vocabulary axes:                        ${inVocabAxis}  (${pct(inVocabAxis, total)}%)`,
    `Out-of-vocabulary axes:                    ${oovAxis}  (${pct(oovAxis, total)}%)`,
    `In-vocabulary values (axis-allowed):       ${inVocabValue}  (${pct(inVocabValue, total)}%)`,
    `Free-form values (axis is free-form):      ${freeFormValue}  (${pct(freeFormValue, total)}%)`,
    `Out-of-vocabulary values (axis enum miss): ${oovValue}  (${pct(oovValue, total)}%)`,
    "",
  ];

  const sortedOovAxes = [...oovAxisCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  if (sortedOovAxes.length > 0) {
    lines.push("Top 10 out-of-vocabulary axes (AI proposed; not in mode vocabulary):");
    lines.push("  " + "axis".padEnd(28) + " count   products  %catalog  candidate?");
    for (const [axis, count] of sortedOovAxes) {
      const productsForAxis = newAxisProducts.get(axis)?.size ?? 0;
      const catalogPct = productCount > 0 ? (productsForAxis / productCount) * 100 : 0;
      const flag = catalogPct > 10
        ? "POTENTIAL VOCABULARY EXTENSION CANDIDATE"
        : (catalogPct > 1 ? "minor — review" : "—");
      lines.push(
        "  " + axis.padEnd(28) + ` ${String(count).padStart(5)}   ` +
        `${String(productsForAxis).padStart(6)}    ${catalogPct.toFixed(1).padStart(4)}%   ${flag}`,
      );
    }
    lines.push("");
  } else {
    lines.push("No out-of-vocabulary axes proposed.");
    lines.push("");
  }

  const flatOovValues: { axis: string; value: string; count: number }[] = [];
  for (const [axis, m] of oovValueCountsByAxis.entries()) {
    for (const [value, count] of m.entries()) {
      flatOovValues.push({ axis, value, count });
    }
  }
  flatOovValues.sort((a, b) => b.count - a.count);
  const top = flatOovValues.slice(0, 10);
  if (top.length > 0) {
    lines.push("Top 10 out-of-vocabulary values within in-vocabulary axes:");
    lines.push("  " + "axis".padEnd(20) + " value".padEnd(28) + "count");
    for (const { axis, value, count } of top) {
      lines.push("  " + axis.padEnd(20) + value.padEnd(28) + count);
    }
    lines.push("");
  }

  lines.push("Surface trigger: any axis flagged 'POTENTIAL VOCABULARY EXTENSION CANDIDATE'");
  lines.push("appears in >10% of products and warrants either adding to the mode's");
  lines.push("STARTER_AXES or treating its presence as expected gap (per PR-2.2 plan");
  lines.push("item 1's reasoning for the FASHION smoke vocabulary gaps).");
  lines.push("");
  return lines.join("\n");
}

function renderCostReconciliation(p: {
  job: TaggingJobRow;
  summary: Record<string, unknown>;
  totalCostUsd: number;
  totalCostMicros: bigint;
}): string {
  const { job, summary, totalCostUsd, totalCostMicros } = p;
  const projectedUsd = (summary.projectedTotalUsd as number | undefined) ?? null;
  const projectedPerProductUsd = (summary.projectedPerProductUsd as number | undefined) ?? null;
  const kickoffMeanChars = (summary.kickoffMeanChars as number | undefined) ?? null;
  const divergencePct = projectedUsd
    ? ((totalCostUsd - projectedUsd) / projectedUsd) * 100
    : null;

  const capMicros = BigInt(process.env.TAGGING_BACKFILL_BUDGET_USD_MICROS ?? 10_000_000);
  const capUsd = microsToUsd(capMicros);
  const remainingUsd = capUsd - totalCostUsd;

  const lines: string[] = [
    `Cost reconciliation`,
    `Generated: ${new Date().toISOString()}`,
    `Job:       ${job.id}`,
    "",
    "----------------------------------------",
    `Projected total (kickoff):     ${projectedUsd !== null ? `$${projectedUsd.toFixed(4)}` : "—"}`,
    `Projected per-product:         ${projectedPerProductUsd !== null ? `$${projectedPerProductUsd.toFixed(6)}` : "—"}`,
    `Sampled mean description:      ${kickoffMeanChars !== null ? `${kickoffMeanChars} chars` : "—"}`,
    "",
    `Actual total:                  $${totalCostUsd.toFixed(4)}`,
    `Actual total (microdollars):   ${totalCostMicros.toString()}`,
    "",
    `Divergence:                    ${divergencePct !== null ? `${divergencePct >= 0 ? "+" : ""}${divergencePct.toFixed(1)}%` : "—"}`,
    "----------------------------------------",
    `Backfill budget cap:           $${capUsd.toFixed(4)}`,
    `Budget remaining:              $${remainingUsd.toFixed(4)}`,
    `Budget utilization:            ${pct(Number(totalCostMicros), Number(capMicros))}%`,
    "",
  ];

  if (divergencePct !== null && Math.abs(divergencePct) > 50) {
    lines.push("");
    lines.push(`PROJECTION RECALIBRATION NEEDED — actual diverged from projected by ${divergencePct.toFixed(1)}%.`);
    lines.push(`The cost-per-Kc anchor in scripts/start-fashion-backfill.mjs may be stale.`);
    lines.push(`Recompute: actual_total_usd / sum(description_lengths_in_kchars)`);
    lines.push(`           = $${totalCostUsd.toFixed(4)} / X kchars = new cost-per-Kc`);
    lines.push("");
  }
  return lines.join("\n");
}

function renderRuleCoverage(p: {
  ruleTagsRes: pg.QueryResult<TagRow>;
  aiTagsRes: pg.QueryResult<TagRow>;
  productCount: number;
}): string {
  const { ruleTagsRes, aiTagsRes, productCount } = p;
  const rulesPerProduct = new Map<string, number>();
  const ruleAxes = new Map<string, number>();
  for (const r of ruleTagsRes.rows) {
    rulesPerProduct.set(r.productId, (rulesPerProduct.get(r.productId) ?? 0) + 1);
    ruleAxes.set(r.axis, (ruleAxes.get(r.axis) ?? 0) + 1);
  }

  const aiAxesPerProduct = new Map<string, Set<string>>();
  for (const t of aiTagsRes.rows) {
    if (!aiAxesPerProduct.has(t.productId)) aiAxesPerProduct.set(t.productId, new Set());
    aiAxesPerProduct.get(t.productId)!.add(t.axis);
  }
  const axesNeededValues = [...aiAxesPerProduct.values()].map((s) => s.size);
  axesNeededValues.sort((a, b) => a - b);
  const meanAxesNeeded = axesNeededValues.length > 0
    ? axesNeededValues.reduce((acc, n) => acc + n, 0) / axesNeededValues.length
    : 0;
  const medianAxesNeeded = percentile(axesNeededValues, 0.5);

  const buckets = new Map<number, number>();
  for (const n of axesNeededValues) {
    buckets.set(n, (buckets.get(n) ?? 0) + 1);
  }
  const sortedBuckets = [...buckets.entries()].sort((a, b) => a[0] - b[0]);
  const maxBucket = Math.max(...buckets.values(), 1);

  const lines: string[] = [
    `Rule-engine coverage stats`,
    `Generated: ${new Date().toISOString()}`,
    "",
    "----------------------------------------",
    `Total rule-tag rows written:      ${ruleTagsRes.rows.length}`,
    `Total AI-tag rows written:        ${aiTagsRes.rows.length}`,
    `Distinct products tagged:         ${productCount}`,
    "",
    `Mean axesNeeded (per product):    ${meanAxesNeeded.toFixed(2)}`,
    `Median axesNeeded:                ${medianAxesNeeded}`,
    "----------------------------------------",
    `axesNeeded distribution histogram (axes-asked-of-AI per product):`,
  ];
  for (const [n, count] of sortedBuckets) {
    lines.push(`  ${String(n).padStart(2)} axes: ${asciiBar(count, maxBucket)} ${count}`);
  }
  lines.push("");
  lines.push("----------------------------------------");
  lines.push(`Per-axis rule firing counts:`);
  const sortedRuleAxes = [...ruleAxes.entries()].sort((a, b) => b[1] - a[1]);
  if (sortedRuleAxes.length === 0) {
    lines.push("  (no rule-tag rows in this run)");
  } else {
    for (const [axis, count] of sortedRuleAxes) {
      lines.push(`  ${axis.padEnd(20)} ${count}`);
    }
  }
  lines.push("");
  return lines.join("\n");
}

function renderCostHistogram(p: {
  byProduct: Map<string, ProductBucket>;
  totalCostUsd: number;
}): string {
  const { byProduct, totalCostUsd } = p;
  const products = [...byProduct.values()];
  const tagsWritten = products.map((b) => b.tags.length).sort((a, b) => a - b);
  const meanTags = tagsWritten.length > 0
    ? tagsWritten.reduce((a, b) => a + b, 0) / tagsWritten.length
    : 0;

  const lengths = products.map((b) => b.descLen).sort((a, b) => a - b);
  const lenBuckets: { label: string; lo: number; hi: number; count: number }[] = [
    { label: "  <500c", lo: 0, hi: 500, count: 0 },
    { label: "  500-1k", lo: 500, hi: 1000, count: 0 },
    { label: "  1-2k", lo: 1000, hi: 2000, count: 0 },
    { label: "  2-3k", lo: 2000, hi: 3000, count: 0 },
    { label: "  3-4k", lo: 3000, hi: 4000, count: 0 },
    { label: "  4-5k", lo: 4000, hi: 5000, count: 0 },
    { label: "  5k+", lo: 5000, hi: Infinity, count: 0 },
  ];
  for (const l of lengths) {
    for (const b of lenBuckets) {
      if (l >= b.lo && l < b.hi) { b.count++; break; }
    }
  }
  const maxLen = Math.max(...lenBuckets.map((b) => b.count), 1);

  const tagsBuckets = new Map<number, number>();
  for (const n of tagsWritten) tagsBuckets.set(n, (tagsBuckets.get(n) ?? 0) + 1);
  const sortedTags = [...tagsBuckets.entries()].sort((a, b) => a[0] - b[0]);
  const maxTags = Math.max(...tagsBuckets.values(), 1);

  const byTags = [...products].sort((a, b) => b.tags.length - a.tags.length).slice(0, 5);
  const byLen = [...products].sort((a, b) => b.descLen - a.descLen).slice(0, 5);

  const lines: string[] = [
    `Cost / shape histograms`,
    `Generated: ${new Date().toISOString()}`,
    `Distinct products tagged: ${products.length}`,
    `Mean tags per product:    ${meanTags.toFixed(2)}`,
    "",
    "----------------------------------------",
    `Description-length distribution (proxy for cost shape):`,
  ];
  for (const b of lenBuckets) {
    lines.push(`${b.label.padEnd(10)} ${asciiBar(b.count, maxLen)} ${b.count}`);
  }
  lines.push("");
  lines.push("----------------------------------------");
  lines.push(`Tags-written-per-product distribution:`);
  for (const [n, count] of sortedTags) {
    lines.push(`  ${String(n).padStart(2)} tags: ${asciiBar(count, maxTags)} ${count}`);
  }
  lines.push("");
  lines.push("----------------------------------------");
  lines.push("Top 5 products by tags written:");
  for (const b of byTags) {
    lines.push(`  ${String(b.tags.length).padStart(3)} tags  ${b.descLen.toString().padStart(6)}c  ${(b.title ?? "").slice(0, 60)}`);
  }
  lines.push("");
  lines.push("Top 5 products by description length:");
  for (const b of byLen) {
    lines.push(`  ${String(b.descLen).padStart(6)}c  ${String(b.tags.length).padStart(3)} tags  ${(b.title ?? "").slice(0, 60)}`);
  }
  lines.push("");
  lines.push(`Total cost across run: $${totalCostUsd.toFixed(4)}`);
  lines.push("");
  return lines.join("\n");
}

function renderSampleAudit(p: {
  byProduct: Map<string, ProductBucket>;
  productCount: number;
  mode: StoreMode;
}): string {
  const { byProduct, productCount, mode } = p;
  const N = productCount;
  const sampleSize = Math.floor(Math.min(50, Math.max(15, Math.ceil(N * 0.025))));

  const products = [...byProduct.values()];
  products.sort((a, b) => a.descLen - b.descLen);
  const third = Math.floor(products.length / 3);
  const shortBucket = products.slice(0, third);
  const midBucket = products.slice(third, 2 * third);
  const longBucket = products.slice(2 * third);

  const perStratum = Math.floor(sampleSize / 3);
  const remainder = sampleSize - perStratum * 3;

  const sampled: ProductBucket[] = [
    ...sampleN(shortBucket, perStratum),
    ...sampleN(midBucket, perStratum),
    ...sampleN(longBucket, perStratum + remainder),
  ];

  const lines: string[] = [
    `Sample audit (n=${sampled.length}, stratified by description length)`,
    `Generated: ${new Date().toISOString()}`,
    `Mode: ${mode}`,
    "",
    "Hand-eyeball this for systematic AI failures. Red flags:",
    "  - Same value across many unrelated products (e.g. occasion=casual on every item)",
    "  - Axes that don't match product category (e.g. material=cotton on a metal jewellery item)",
    "  - Missing obvious tags (e.g. no color_family on a clearly-colored item)",
    "  - Confidence values clustered at extremes (all 0.99 or all 0.5)",
    "",
    "================================================================================",
  ];

  for (const b of sampled) {
    lines.push("");
    lines.push(`Product:       ${b.shopifyId}`);
    lines.push(`Title:         ${(b.title ?? "—").slice(0, 80)}`);
    lines.push(`ProductType:   ${b.productType ?? "—"}`);
    lines.push(`Vendor:        ${b.vendor ?? "—"}`);
    lines.push(`Desc length:   ${b.descLen} chars`);
    lines.push(`Desc preview:  ${stripAndTruncate(b.descriptionHtml ?? "", 200)}`);
    lines.push(`Tags written:  ${b.tags.length}`);
    for (const t of b.tags) {
      lines.push(`  ${t.axis.padEnd(20)} = ${(t.value ?? "").padEnd(30)} conf=${t.confidence ?? "—"} status=${t.status}`);
    }
    lines.push("--------------------------------------------------------------------------------");
  }
  lines.push("");
  return lines.join("\n");
}

function sampleN<T>(arr: T[], n: number): T[] {
  if (n >= arr.length) return arr.slice();
  const indices = new Set<number>();
  while (indices.size < n) {
    indices.add(Math.floor(Math.random() * arr.length));
  }
  return [...indices].map((i) => arr[i]);
}

function stripAndTruncate(html: string, n: number): string {
  const text = html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  return text.length > n ? text.slice(0, n) + "…" : text;
}

// Guard so vitest (and any other importer of classifyTagPair) doesn't
// trigger main() at module-load time. Standard ESM "is this the
// entry point?" pattern: compare import.meta.url against argv[1].
const invokedAsScript =
  typeof process.argv[1] === "string" &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedAsScript) {
  main().catch((err: unknown) => {
    // eslint-disable-next-line no-console
    console.error(`UNCAUGHT: ${err instanceof Error ? err.stack : String(err)}`);
    process.exit(1);
  });
}
