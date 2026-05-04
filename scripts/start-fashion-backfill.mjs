// PR-2.2: kickoff script for INITIAL_BACKFILL.
//
// Validates inputs, reads catalog distribution from the deployed DB,
// projects cost + wall-clock at runtime, and enqueues one
// INITIAL_BACKFILL TaggingJob row. Worker drains async.
//
// Usage:
//   node scripts/start-fashion-backfill.mjs --shop <shopDomain>
//                                           [--limit N] [--force]
//                                           [--skip-confirm]
//
// Why "fashion" in the name: the dev shop happens to be FASHION mode.
// The script itself is shop-agnostic — operates against any merchant
// in any mode. Rename when a non-FASHION merchant onboards.

import "dotenv/config";
import pg from "pg";
import { randomUUID } from "node:crypto";

const { Client } = pg;

// Cost-per-Kc anchor: derived from PR-2.1 smoke evidence —
// $0.007077 at 6,296 input chars (descriptionHtml + ~400-token
// system prompt and metadata overhead). cost-per-Kc ≈ $0.0011.
// Update this constant when the cost-per-Kc anchor materially shifts
// (e.g. Anthropic pricing change or material model swap).
const COST_PER_KCHAR_USD = 0.0011;

// Mean wall-clock per Anthropic call, anchored to PR-2.1 smoke (3415ms
// for the full p100 product). Used for runtime estimation only.
const MEAN_CALL_MS = 4000;

function parseArgs(argv) {
  const args = { shop: null, limit: null, force: false, skipConfirm: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--shop") args.shop = argv[++i];
    else if (a === "--limit") {
      const n = parseInt(argv[++i], 10);
      if (!Number.isFinite(n) || n <= 0) {
        die(`--limit must be a positive integer, got: ${argv[i]}`);
      }
      args.limit = n;
    } else if (a === "--force") args.force = true;
    else if (a === "--skip-confirm") args.skipConfirm = true;
    else if (a === "--help" || a === "-h") usage(0);
  }
  return args;
}

function usage(code) {
  console.log(`Usage: node scripts/start-fashion-backfill.mjs --shop <shopDomain>
  [--limit N]        Cap iteration at N products (default: unlimited).
  [--force]          Bypass the prior-backfill check.
  [--skip-confirm]   Skip the 10-second pre-spend pause on unlimited runs.`);
  process.exit(code);
}

function die(msg) {
  console.error(`ERROR: ${msg}`);
  process.exit(1);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.shop) die("--shop is required.");

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  // 1. Validate shop exists in MerchantConfig.
  const cfg = await client.query(
    `SELECT shop, "storeMode" FROM "MerchantConfig" WHERE shop = $1`,
    [args.shop],
  );
  if (cfg.rows.length === 0) {
    await client.end();
    die(`No MerchantConfig row for shop "${args.shop}". Has the app been installed?`);
  }
  console.log(`Shop validated: ${args.shop} (mode: ${cfg.rows[0].storeMode})`);

  // 2. Prior-backfill check.
  const prior = await client.query(
    `SELECT id, status, "finishedAt", "processedProducts", "totalProducts"
     FROM "TaggingJob"
     WHERE "shopDomain" = $1
       AND kind = 'INITIAL_BACKFILL'
       AND status IN ('SUCCEEDED', 'FAILED', 'BUDGET_PAUSED', 'CANCELLED')
     ORDER BY "enqueuedAt" DESC
     LIMIT 1`,
    [args.shop],
  );
  if (prior.rows.length > 0 && !args.force) {
    const p = prior.rows[0];
    await client.end();
    console.error(
      `\nPrior INITIAL_BACKFILL exists for this shop:\n` +
      `  jobId:             ${p.id}\n` +
      `  status:            ${p.status}\n` +
      `  finishedAt:        ${p.finishedAt?.toISOString() ?? "—"}\n` +
      `  processedProducts: ${p.processedProducts}\n` +
      `  totalProducts:     ${p.totalProducts}\n\n` +
      `Re-running INITIAL_BACKFILL re-tags every active product, costing\n` +
      `the same as a fresh run. Pass --force to bypass this check if that\n` +
      `is intentional (e.g. mode change, vocabulary redesign).\n`,
    );
    process.exit(2);
  }
  if (prior.rows.length > 0 && args.force) {
    console.log(`force-bypassing prior backfill check (last run: ${prior.rows[0].id} → ${prior.rows[0].status})`);
  }

  // 3. Active-product count.
  const countRes = await client.query(
    `SELECT COUNT(*)::int AS n
     FROM "Product"
     WHERE "shopDomain" = $1 AND "deletedAt" IS NULL AND status = 'ACTIVE'`,
    [args.shop],
  );
  const activeCount = countRes.rows[0].n;
  console.log(`Shop ${args.shop}: ${activeCount} active products.`);
  if (activeCount === 0) {
    await client.end();
    die("Shop has no active products to tag.");
  }

  const target = args.limit !== null ? Math.min(args.limit, activeCount) : activeCount;

  // 4. Cost projection. Sample 30 random active products' description
  // length and project from the cost-per-Kc anchor.
  const sample = await client.query(
    `SELECT length(coalesce("descriptionHtml", ''))::int AS l
     FROM "Product"
     WHERE "shopDomain" = $1 AND "deletedAt" IS NULL AND status = 'ACTIVE'
     ORDER BY random() LIMIT 30`,
    [args.shop],
  );
  const meanChars = sample.rows.length > 0
    ? sample.rows.reduce((acc, r) => acc + r.l, 0) / sample.rows.length
    : 0;
  const perProductUsd = (meanChars / 1000) * COST_PER_KCHAR_USD;
  const totalUsd = target * perProductUsd;
  const wallClockMin = (target * MEAN_CALL_MS) / 1000 / 60;

  console.log(
    `Sampled mean description: ${Math.round(meanChars)} chars (n=${sample.rows.length})`,
  );
  console.log(
    `Estimated cost: ~$${totalUsd.toFixed(2)} across ${target} products` +
      (args.limit !== null ? ` (capped by --limit)` : "") +
      `.`,
  );
  console.log(`Estimated wall-clock: ~${Math.ceil(wallClockMin)} minutes.`);

  // 5. Pre-spend pause.
  if (args.limit === null && !args.skipConfirm) {
    console.log(
      `\nWARNING: this is an unlimited run on the full active catalog.\n` +
      `Recommend a --limit 5 dry-run first to validate the handler before\n` +
      `authorizing full spend. Press Ctrl+C in 10 seconds to abort, or\n` +
      `pass --skip-confirm to skip this pause.`,
    );
    await sleep(10_000);
  } else if (args.limit !== null && args.limit <= 10) {
    console.log(
      `\nLIMITED RUN: --limit ${args.limit}. Estimated cost ~$${totalUsd.toFixed(4)}.\n` +
      `Proceeding without confirmation prompt.`,
    );
  }

  // 6. Enqueue. Use raw INSERT to avoid a runtime dep on the Prisma
  // client (which is in Data-Proxy mode locally).
  const id = `cuid_${randomUUID().replace(/-/g, "")}`;
  const ins = await client.query(
    `INSERT INTO "TaggingJob"
       (id, "shopDomain", kind, status, "triggerSource", summary, "updatedAt")
     VALUES ($1, $2, 'INITIAL_BACKFILL', 'QUEUED', 'INITIAL_BACKFILL', $3::jsonb, NOW())
     RETURNING id, "enqueuedAt"`,
    [
      id,
      args.shop,
      JSON.stringify({
        kind: "INITIAL_BACKFILL",
        limit: args.limit ?? null,
        kickoffMeanChars: Math.round(meanChars),
        projectedTotalUsd: Number(totalUsd.toFixed(4)),
        projectedPerProductUsd: Number(perProductUsd.toFixed(6)),
        kickoffActiveCount: activeCount,
      }),
    ],
  );

  console.log(
    `\nINITIAL_BACKFILL enqueued.\n` +
    `  jobId:      ${ins.rows[0].id}\n` +
    `  enqueuedAt: ${ins.rows[0].enqueuedAt.toISOString()}\n` +
    `  shop:       ${args.shop}\n` +
    `  target:     ${target} products\n` +
    `  projected:  ~$${totalUsd.toFixed(2)}\n\n` +
    `The worker will claim within 2-5s and drain serially. Run\n` +
    `  npx tsx scripts/report-backfill.ts --shop ${args.shop}\n` +
    `after the run completes for the verification artifacts.\n`,
  );

  await client.end();
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

main().catch((err) => {
  console.error(`UNCAUGHT: ${err instanceof Error ? err.stack : String(err)}`);
  process.exit(1);
});
