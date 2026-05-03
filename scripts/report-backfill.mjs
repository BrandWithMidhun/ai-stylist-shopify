// PR-2.2: post-run reporter for INITIAL_BACKFILL.
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
//   node scripts/report-backfill.mjs --shop <shopDomain> [--job-id <id>]

import "dotenv/config";
import pg from "pg";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const { Client } = pg;
const ARTIFACTS_DIR = ".pr-2-2-artifacts";

// Mirrors store-axes.ts STARTER_AXES + axis-options.ts vocabulary.
// Hand-mirrored here because the reporter runs outside the TS module
// graph; keep in sync if either file changes.
const STARTER_AXES = {
  FASHION: new Set([
    "gender", "category", "sub_category", "fit", "color_family",
    "occasion", "style_type", "statement_piece", "material",
    "size_range", "price_tier",
  ]),
  ELECTRONICS: new Set([
    "category", "brand", "form_factor", "use_case", "price_tier",
    "connectivity", "color", "target_user",
  ]),
  FURNITURE: new Set([
    "category", "style", "material", "room", "size_class", "color",
    "assembly_required", "price_tier",
  ]),
  BEAUTY: new Set([
    "category", "skin_type", "concern", "ingredient_class", "finish",
    "hair_type", "formulation", "price_tier",
  ]),
  JEWELLERY: new Set([
    "category", "metal", "purity", "gemstone", "craft_type",
    "weight_grams", "occasion", "style", "target_audience",
    "price_tier", "certification",
  ]),
  GENERAL: new Set([
    "category", "color", "style", "use_case", "price_tier",
    "size", "target_audience",
  ]),
};

// Per-axis enumerated values (from axis-options.ts). Axes not listed
// or set to "free-form" accept any value. FASHION is the priority for
// the dev-shop run; other modes are scaffolded and validated when a
// real merchant onboards (per PR-2.2 plan items 2-6).
const AXIS_VALUES = {
  FASHION: {
    gender: new Set(["male", "female", "unisex", "kids"]),
    category: new Set([
      "shirt", "t_shirt", "kurta", "pants", "jeans", "shorts", "dress",
      "skirt", "jacket", "sweater", "saree", "lehenga", "innerwear",
      "footwear", "accessories",
    ]),
    sub_category: "free-form",
    fit: new Set(["slim", "regular", "relaxed", "oversized", "tailored"]),
    color_family: new Set([
      "black", "white", "grey", "blue", "navy", "red", "green",
      "yellow", "pink", "purple", "brown", "beige", "orange", "multicolor",
    ]),
    occasion: new Set(["work", "casual", "travel", "event", "formal", "festive"]),
    style_type: new Set([
      "minimal", "classic", "relaxed", "bold", "preppy", "streetwear",
      "ethnic", "athleisure",
    ]),
    statement_piece: new Set(["statement_piece", "not_a_statement_piece"]),
    material: new Set([
      "cotton", "linen", "silk", "denim", "wool", "polyester", "leather",
      "synthetic", "blended", "cashmere",
    ]),
    size_range: new Set(["xs", "s", "m", "l", "xl", "xxl", "xxxl", "one_size"]),
    price_tier: new Set(["budget", "mid_range", "premium", "luxury"]),
  },
};

function parseArgs(argv) {
  const args = { shop: null, jobId: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--shop") args.shop = argv[++i];
    else if (argv[i] === "--job-id") args.jobId = argv[++i];
    else if (argv[i] === "--help" || argv[i] === "-h") {
      console.log(`Usage: node scripts/report-backfill.mjs --shop <shopDomain> [--job-id <id>]`);
      process.exit(0);
    }
  }
  return args;
}

function die(msg) {
  console.error(`ERROR: ${msg}`);
  process.exit(1);
}

function ensureDir(path) {
  mkdirSync(dirname(path), { recursive: true });
}

function microsToUsd(micros) {
  return Number(micros) / 1_000_000;
}

function pct(num, den) {
  return den > 0 ? ((num / den) * 100).toFixed(1) : "0.0";
}

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * p));
  return sorted[idx];
}

function asciiBar(count, scale, width = 50) {
  const filled = Math.min(width, Math.round((count / scale) * width));
  return "█".repeat(filled) + " ".repeat(width - filled);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.shop) die("--shop is required.");

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  // Locate the INITIAL_BACKFILL row.
  const jobRes = args.jobId
    ? await client.query(`SELECT * FROM "TaggingJob" WHERE id = $1`, [args.jobId])
    : await client.query(
        `SELECT * FROM "TaggingJob"
         WHERE "shopDomain" = $1 AND kind = 'INITIAL_BACKFILL'
         ORDER BY "enqueuedAt" DESC LIMIT 1`,
        [args.shop],
      );
  if (jobRes.rows.length === 0) {
    await client.end();
    die(`No INITIAL_BACKFILL TaggingJob found for shop "${args.shop}"${args.jobId ? ` with id ${args.jobId}` : ""}.`);
  }
  const job = jobRes.rows[0];
  if (!["SUCCEEDED", "FAILED", "BUDGET_PAUSED", "CANCELLED"].includes(job.status)) {
    await client.end();
    console.error(
      `Job ${job.id} is still ${job.status}. Wait for the worker to drain or kill it manually before reporting.`,
    );
    process.exit(2);
  }

  // Get shop mode for vocabulary lookup.
  const cfgRes = await client.query(
    `SELECT "storeMode" FROM "MerchantConfig" WHERE shop = $1`,
    [args.shop],
  );
  const mode = cfgRes.rows[0]?.storeMode ?? "GENERAL";

  // Fetch all ProductTag + Product rows touched by the run. The cleanest
  // proxy: AI-source ProductTag rows whose createdAt is >= job.startedAt.
  // (Audit-row coverage: ProductTagAudit also matches on createdAt; we
  // use ProductTag because it carries confidence + status.)
  const startedAtIso = job.startedAt?.toISOString();
  const tagsRes = await client.query(
    `SELECT pt.*, p.id AS "p_id", p."shopifyId", p.title, p."productType",
            p.vendor, length(coalesce(p."descriptionHtml", ''))::int AS desc_len,
            p."descriptionHtml"
     FROM "ProductTag" pt
     JOIN "Product" p ON p.id = pt."productId"
     WHERE pt."shopDomain" = $1 AND pt.source = 'AI' AND pt."createdAt" >= $2::timestamptz
     ORDER BY pt."createdAt" ASC`,
    [args.shop, startedAtIso],
  );

  const ruleTagsRes = await client.query(
    `SELECT pt.*, p.id AS "p_id"
     FROM "ProductTag" pt
     JOIN "Product" p ON p.id = pt."productId"
     WHERE pt."shopDomain" = $1 AND pt.source = 'RULE' AND pt."createdAt" >= $2::timestamptz`,
    [args.shop, startedAtIso],
  );

  // Per-product summaries: tagsWritten count + cumulative cost
  // approximated from token counts on the row's audit trail. Since
  // we don't store per-product cost separately, we approximate by
  // attributing the job's total cost proportionally to per-product
  // token usage. For per-product cost this isn't exact — the
  // distribution shape in the histogram is the substantive output,
  // not the per-product absolute number.
  const byProduct = new Map();
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
    byProduct.get(key).tags.push(t);
  }

  const totalProducts = job.totalProducts ?? 0;
  const processed = job.processedProducts ?? 0;
  const failed = job.failedProducts ?? 0;
  const totalCostMicros = BigInt(job.costUsdMicros ?? 0);
  const totalCostUsd = microsToUsd(totalCostMicros);
  const summary = job.summary ?? {};

  // ---- 1. run-summary.txt ----
  const runSummary = renderRunSummary({
    job,
    mode,
    totalProducts,
    processed,
    failed,
    totalCostMicros,
    totalCostUsd,
    summary,
    productCount: byProduct.size,
  });
  writeArtifact("run-summary.txt", runSummary);

  // ---- 2. vocab-gap-distribution.txt ----
  const vocabReport = renderVocabGap({ tagsRes, mode, productCount: byProduct.size });
  writeArtifact("vocab-gap-distribution.txt", vocabReport);

  // ---- 3. cost-reconciliation.txt ----
  const costReport = renderCostReconciliation({
    job,
    summary,
    totalCostUsd,
    totalCostMicros,
  });
  writeArtifact("cost-reconciliation.txt", costReport);

  // ---- 4. rule-coverage.txt ----
  const ruleReport = renderRuleCoverage({
    ruleTagsRes,
    aiTagsRes: tagsRes,
    productCount: byProduct.size,
  });
  writeArtifact("rule-coverage.txt", ruleReport);

  // ---- 5. cost-histogram.txt ----
  // We approximate per-product cost from per-product tag counts and
  // mean cost per tag for the run. Imperfect but shape-true.
  const histReport = renderCostHistogram({ byProduct, totalCostUsd });
  writeArtifact("cost-histogram.txt", histReport);

  // ---- 6. sample-audit.txt ----
  const auditReport = renderSampleAudit({
    byProduct,
    productCount: byProduct.size,
    mode,
  });
  writeArtifact("sample-audit.txt", auditReport);

  console.log(`Reporter generated 6 artifacts in ${ARTIFACTS_DIR}/:`);
  console.log("  run-summary.txt");
  console.log("  vocab-gap-distribution.txt");
  console.log("  cost-reconciliation.txt");
  console.log("  rule-coverage.txt");
  console.log("  cost-histogram.txt");
  console.log("  sample-audit.txt");

  await client.end();
}

function writeArtifact(name, content) {
  const path = `${ARTIFACTS_DIR}/${name}`;
  ensureDir(path);
  writeFileSync(path, content);
}

// ---- Renderers --------------------------------------------------------

function renderRunSummary({ job, mode, totalProducts, processed, failed, totalCostMicros, totalCostUsd, summary, productCount }) {
  const success = totalProducts > 0 ? pct(processed, totalProducts) : "—";
  const errorCounts = summary.errorCounts ?? {};
  const startMs = job.startedAt ? new Date(job.startedAt).getTime() : 0;
  const endMs = job.finishedAt ? new Date(job.finishedAt).getTime() : 0;
  const durationMin = endMs > 0 && startMs > 0 ? ((endMs - startMs) / 1000 / 60).toFixed(1) : "—";

  const meanUsd = processed > 0 ? totalCostUsd / processed : 0;
  // Derive p50/p95 of per-product cost from token-count distribution.
  // We don't have per-product cost rows; this is an approximation.
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

function renderVocabGap({ tagsRes, mode, productCount }) {
  const knownAxes = STARTER_AXES[mode] ?? new Set();
  const knownValues = AXIS_VALUES[mode] ?? {};

  const total = tagsRes.rows.length;
  let inVocabAxis = 0, oovAxis = 0;
  let inVocabValue = 0, oovValue = 0, freeFormValue = 0;
  const oovAxisCounts = new Map();
  const oovValueCountsByAxis = new Map(); // axis -> Map<value, count>
  const newAxisProducts = new Map(); // out-of-vocab axis -> Set<productId>

  for (const t of tagsRes.rows) {
    const axisOk = knownAxes.has(t.axis);
    if (axisOk) inVocabAxis++; else {
      oovAxis++;
      oovAxisCounts.set(t.axis, (oovAxisCounts.get(t.axis) ?? 0) + 1);
      if (!newAxisProducts.has(t.axis)) newAxisProducts.set(t.axis, new Set());
      newAxisProducts.get(t.axis).add(t.productId);
    }
    if (axisOk) {
      const vocab = knownValues[t.axis];
      if (vocab === "free-form" || !vocab) {
        freeFormValue++;
      } else if (vocab.has(t.value)) {
        inVocabValue++;
      } else {
        oovValue++;
        if (!oovValueCountsByAxis.has(t.axis)) oovValueCountsByAxis.set(t.axis, new Map());
        const m = oovValueCountsByAxis.get(t.axis);
        m.set(t.value, (m.get(t.value) ?? 0) + 1);
      }
    }
  }

  const lines = [
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

  // Top 10 OOV axes
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

  // Top 10 OOV values (within in-vocabulary axes)
  const flatOovValues = [];
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

function renderCostReconciliation({ job, summary, totalCostUsd, totalCostMicros }) {
  const projectedUsd = summary.projectedTotalUsd ?? null;
  const projectedPerProductUsd = summary.projectedPerProductUsd ?? null;
  const kickoffMeanChars = summary.kickoffMeanChars ?? null;
  const divergencePct = projectedUsd
    ? ((totalCostUsd - projectedUsd) / projectedUsd) * 100
    : null;

  // Backfill cap from env (fallback to default if unset).
  const capMicros = BigInt(process.env.TAGGING_BACKFILL_BUDGET_USD_MICROS ?? 10_000_000);
  const capUsd = microsToUsd(capMicros);
  const remainingUsd = capUsd - totalCostUsd;

  const lines = [
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

function renderRuleCoverage({ ruleTagsRes, aiTagsRes, productCount }) {
  // Count rule-tag rows per product and AI-tag rows per product.
  const rulesPerProduct = new Map();
  const aiPerProduct = new Map();
  const ruleAxes = new Map(); // axis -> count
  for (const r of ruleTagsRes.rows) {
    rulesPerProduct.set(r.productId, (rulesPerProduct.get(r.productId) ?? 0) + 1);
    ruleAxes.set(r.axis, (ruleAxes.get(r.axis) ?? 0) + 1);
  }
  for (const t of aiTagsRes.rows) {
    aiPerProduct.set(t.productId, (aiPerProduct.get(t.productId) ?? 0) + 1);
  }

  // axesNeeded ≈ 11 (FASHION) - rulesPerProduct (rough proxy).
  // Better proxy: count of axes the AI proposed per product (since
  // axesNeeded is what AI was asked to fill).
  const aiAxesPerProduct = new Map();
  for (const t of aiTagsRes.rows) {
    if (!aiAxesPerProduct.has(t.productId)) aiAxesPerProduct.set(t.productId, new Set());
    aiAxesPerProduct.get(t.productId).add(t.axis);
  }
  const axesNeededValues = [...aiAxesPerProduct.values()].map((s) => s.size);
  axesNeededValues.sort((a, b) => a - b);
  const meanAxesNeeded = axesNeededValues.length > 0
    ? axesNeededValues.reduce((acc, n) => acc + n, 0) / axesNeededValues.length
    : 0;
  const medianAxesNeeded = percentile(axesNeededValues, 0.5);

  // axesNeeded distribution histogram
  const buckets = new Map();
  for (const n of axesNeededValues) {
    buckets.set(n, (buckets.get(n) ?? 0) + 1);
  }
  const sortedBuckets = [...buckets.entries()].sort((a, b) => a[0] - b[0]);
  const maxBucket = Math.max(...buckets.values(), 1);

  const lines = [
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

function renderCostHistogram({ byProduct, totalCostUsd }) {
  // We don't have per-product cost rows. Use tagsWritten as a shape
  // proxy: more tags ≈ higher cost (within a mode). Render the
  // per-product tagsWritten histogram and the per-product cost-
  // approximated histogram for shape.
  const products = [...byProduct.values()];
  const tagsWritten = products.map((p) => p.tags.length).sort((a, b) => a - b);
  const meanTags = tagsWritten.length > 0
    ? tagsWritten.reduce((a, b) => a + b, 0) / tagsWritten.length
    : 0;

  // Bucket by description length as a cost proxy.
  const lengths = products.map((p) => p.descLen).sort((a, b) => a - b);
  const lenBuckets = [
    { label: "  <500c", lo: 0, hi: 500 },
    { label: "  500-1k", lo: 500, hi: 1000 },
    { label: "  1-2k", lo: 1000, hi: 2000 },
    { label: "  2-3k", lo: 2000, hi: 3000 },
    { label: "  3-4k", lo: 3000, hi: 4000 },
    { label: "  4-5k", lo: 4000, hi: 5000 },
    { label: "  5k+", lo: 5000, hi: Infinity },
  ];
  for (const b of lenBuckets) b.count = 0;
  for (const l of lengths) {
    for (const b of lenBuckets) {
      if (l >= b.lo && l < b.hi) { b.count++; break; }
    }
  }
  const maxLen = Math.max(...lenBuckets.map((b) => b.count), 1);

  // Tags histogram
  const tagsBuckets = new Map();
  for (const n of tagsWritten) tagsBuckets.set(n, (tagsBuckets.get(n) ?? 0) + 1);
  const sortedTags = [...tagsBuckets.entries()].sort((a, b) => a[0] - b[0]);
  const maxTags = Math.max(...tagsBuckets.values(), 1);

  // Outliers
  const byTags = [...products].sort((a, b) => b.tags.length - a.tags.length).slice(0, 5);
  const byLen = [...products].sort((a, b) => b.descLen - a.descLen).slice(0, 5);

  const lines = [
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
  for (const p of byTags) {
    lines.push(`  ${String(p.tags.length).padStart(3)} tags  ${p.descLen.toString().padStart(6)}c  ${(p.title ?? "").slice(0, 60)}`);
  }
  lines.push("");
  lines.push("Top 5 products by description length:");
  for (const p of byLen) {
    lines.push(`  ${String(p.descLen).padStart(6)}c  ${String(p.tags.length).padStart(3)} tags  ${(p.title ?? "").slice(0, 60)}`);
  }
  lines.push("");
  lines.push(`Total cost across run: $${totalCostUsd.toFixed(4)}`);
  lines.push("");
  return lines.join("\n");
}

function renderSampleAudit({ byProduct, productCount, mode }) {
  // Sample size: floor(min(50, max(15, ceil(N * 0.025)))). Prompt-spec.
  const N = productCount;
  const sampleSize = Math.floor(Math.min(50, Math.max(15, Math.ceil(N * 0.025))));

  const products = [...byProduct.values()];
  // Stratified by description length: sort, split into thirds, sample
  // floor(sampleSize / 3) from each + remainder from the long bucket.
  products.sort((a, b) => a.descLen - b.descLen);
  const third = Math.floor(products.length / 3);
  const shortBucket = products.slice(0, third);
  const midBucket = products.slice(third, 2 * third);
  const longBucket = products.slice(2 * third);

  const perStratum = Math.floor(sampleSize / 3);
  const remainder = sampleSize - perStratum * 3;

  const sampled = [
    ...sampleN(shortBucket, perStratum),
    ...sampleN(midBucket, perStratum),
    ...sampleN(longBucket, perStratum + remainder),
  ];

  const lines = [
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

  for (const p of sampled) {
    lines.push("");
    lines.push(`Product:       ${p.shopifyId}`);
    lines.push(`Title:         ${(p.title ?? "—").slice(0, 80)}`);
    lines.push(`ProductType:   ${p.productType ?? "—"}`);
    lines.push(`Vendor:        ${p.vendor ?? "—"}`);
    lines.push(`Desc length:   ${p.descLen} chars`);
    lines.push(`Desc preview:  ${stripAndTruncate(p.descriptionHtml ?? "", 200)}`);
    lines.push(`Tags written:  ${p.tags.length}`);
    for (const t of p.tags) {
      lines.push(`  ${t.axis.padEnd(20)} = ${(t.value ?? "").padEnd(30)} conf=${t.confidence ?? "—"} status=${t.status}`);
    }
    lines.push("--------------------------------------------------------------------------------");
  }
  lines.push("");
  return lines.join("\n");
}

function sampleN(arr, n) {
  if (n >= arr.length) return arr.slice();
  const indices = new Set();
  while (indices.size < n) {
    indices.add(Math.floor(Math.random() * arr.length));
  }
  return [...indices].map((i) => arr[i]);
}

function stripAndTruncate(html, n) {
  const text = html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  return text.length > n ? text.slice(0, n) + "…" : text;
}

main().catch((err) => {
  console.error(`UNCAUGHT: ${err instanceof Error ? err.stack : String(err)}`);
  process.exit(1);
});
