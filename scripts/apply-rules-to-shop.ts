import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { applyRules } from "../app/lib/catalog/rule-engine.server";

// Apply enabled TaggingRule rows for a shop across the full catalog,
// writing RULE-source tags where rules match. Bridge mechanism for
// post-onboarding rule additions: seedRules() is shop-level-idempotent
// and bails when any rule exists, so adding a new rule to rule-seeds.ts
// doesn't auto-apply to already-onboarded shops. This script closes that
// gap.
//
// First use case: 3.1.7-mech.4 against ai-fashion-store.myshopify.com,
// after adding category=shorts to SEED_RULES.FASHION + a corresponding
// row in the dev shop's TaggingRule table.
//
// Joins scripts/bulk-approve-tags.ts and scripts/bulk-reembed-products.ts
// as the third item in the "shop onboarding kit": script-parameterized,
// idempotent, dry-runnable, forensic.
//
// Idempotent: rules NEVER overwrite an existing tag value (per
// rule-engine's "purely additive" semantic). Re-running this script on
// a product that already has a tag on the target axis is a no-op for
// that axis. Re-runs are safe.
//
// Usage:
//   tsx scripts/apply-rules-to-shop.ts --shop=<domain> [--axes=<csv>] [--dry-run] [--actor-id=<id>]
//
// Defaults:
//   --shop      ai-fashion-store.myshopify.com
//   --axes      (all FASHION axes; over-broad axesNeeded just lets any rule fire)
//   --actor-id  system://manual-apply-rules

const DEFAULT_SHOP = "ai-fashion-store.myshopify.com";
const DEFAULT_ACTOR_ID = "system://manual-apply-rules";
const DEFAULT_AXES = [
  "gender",
  "category",
  "sub_category",
  "fit",
  "color_family",
  "occasion",
  "material",
  "size_range",
  "style_type",
  "season",
];

function parseArgs(): {
  shop: string;
  axes: string[];
  actorId: string;
  dryRun: boolean;
} {
  let shop = DEFAULT_SHOP;
  let axes = DEFAULT_AXES;
  let actorId = DEFAULT_ACTOR_ID;
  let dryRun = false;

  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith("--shop=")) {
      const v = arg.slice("--shop=".length).trim();
      if (v) shop = v;
    } else if (arg.startsWith("--axes=")) {
      const v = arg.slice("--axes=".length).trim();
      if (v) {
        axes = v
          .split(",")
          .map((a) => a.trim().toLowerCase())
          .filter((a) => a.length > 0);
      }
    } else if (arg.startsWith("--actor-id=")) {
      const v = arg.slice("--actor-id=".length).trim();
      if (v) actorId = v;
    } else if (arg === "--dry-run") {
      dryRun = true;
    }
  }
  return { shop, axes, actorId, dryRun };
}

const {
  shop: SHOP,
  axes: TARGET_AXES,
  actorId: ACTOR_ID,
  dryRun: DRY_RUN,
} = parseArgs();

const prisma = new PrismaClient();

async function snapshot(
  label: string,
  targetAxes: readonly string[],
): Promise<void> {
  // Per-axis ProductTag status + source distribution. Useful to spot
  // "this run flipped N rows from absent → RULE-source APPROVED".
  const counts: Record<string, Record<string, number>> = {};
  const sources: Record<string, Record<string, number>> = {};
  for (const axis of targetAxes) {
    const byStatus = await prisma.productTag.groupBy({
      by: ["status"],
      where: { shopDomain: SHOP, axis },
      _count: { _all: true },
    });
    counts[axis] = {};
    for (const row of byStatus) counts[axis][row.status] = row._count._all;

    const bySource = await prisma.productTag.groupBy({
      by: ["source"],
      where: { shopDomain: SHOP, axis },
      _count: { _all: true },
    });
    sources[axis] = {};
    for (const row of bySource) sources[axis][row.source] = row._count._all;
  }

  console.log(`\n=== ${label} ===`);
  for (const axis of targetAxes) {
    const statusCounts = counts[axis] ?? {};
    const sourceCounts = sources[axis] ?? {};
    const statusStr =
      Object.entries(statusCounts)
        .map(([k, v]) => `${k}=${v}`)
        .join(", ") || "(none)";
    const sourceStr =
      Object.entries(sourceCounts)
        .map(([k, v]) => `${k}=${v}`)
        .join(", ") || "(none)";
    console.log(`  ${axis}: status[${statusStr}] source[${sourceStr}]`);
  }
}

async function main(): Promise<void> {
  console.log(`shopDomain:  ${SHOP}`);
  console.log(`targetAxes:  ${TARGET_AXES.join(", ")}`);
  console.log(`actorId:     ${ACTOR_ID}`);
  console.log(`dryRun:      ${DRY_RUN}`);

  await snapshot("BEFORE", TARGET_AXES);

  // Load enabled rules once. applyRules' `rules` arg is optional —
  // passing it skips the per-product re-load.
  const rules = await prisma.taggingRule.findMany({
    where: { shopDomain: SHOP, enabled: true },
    orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
  });
  console.log(`\nEnabled rules: ${rules.length}`);

  if (rules.length === 0) {
    console.log("No enabled rules for this shop. Nothing to apply.");
    await prisma.$disconnect();
    return;
  }

  // ACTIVE non-deleted products + their existing tags (applyRules reads
  // the tags relation to enforce purely-additive semantics).
  const products = await prisma.product.findMany({
    where: {
      shopDomain: SHOP,
      status: "ACTIVE",
      deletedAt: null,
    },
    include: { tags: true },
  });
  console.log(`Products to evaluate: ${products.length}`);

  let totalTagsWritten = 0;
  let productsTouched = 0;
  const perAxisWrites: Record<string, number> = {};

  for (const product of products) {
    const result = await applyRules({
      shopDomain: SHOP,
      product,
      axesNeeded: TARGET_AXES,
      rules,
      dryRun: DRY_RUN,
      actorId: ACTOR_ID,
    });
    if (result.tagsWritten.length > 0) {
      productsTouched += 1;
      totalTagsWritten += result.tagsWritten.length;
      for (const w of result.tagsWritten) {
        perAxisWrites[w.axis] = (perAxisWrites[w.axis] ?? 0) + 1;
      }
    }
  }

  console.log(`\nProducts touched:   ${productsTouched}`);
  console.log(`Total tags written: ${totalTagsWritten}`);
  console.log(`Per-axis writes:`);
  for (const [axis, count] of Object.entries(perAxisWrites)) {
    console.log(`  ${axis}: ${count}`);
  }

  if (DRY_RUN) {
    console.log("\n--dry-run: writes were not persisted.");
  }

  await snapshot(
    `AFTER${DRY_RUN ? " (dry-run, unchanged)" : ""}`,
    TARGET_AXES,
  );
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
