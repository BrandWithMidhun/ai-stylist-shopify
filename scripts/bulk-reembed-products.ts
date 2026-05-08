import "dotenv/config";
import { PrismaClient } from "@prisma/client";

/**
 * Bulk RE_EMBED enqueue for a shop's ACTIVE products that lack an
 * embeddingContentHash. Mirrors the canonical "shop onboarding kit"
 * pattern established by scripts/bulk-approve-tags.ts.
 *
 * Usage:
 *   npx tsx scripts/bulk-reembed-products.ts --shop=<domain> [--dry-run]
 *
 * Filter applied (matches v2 pipeline read-path):
 *   embeddingContentHash IS NULL
 *   AND status = 'ACTIVE'
 *   AND deletedAt IS NULL
 *   AND recommendationExcluded = false
 *
 * Idempotent: uses createMany with skipDuplicates=true, defended by the
 * partial unique index (shopDomain, productId) WHERE status='QUEUED'.
 *
 * One-shot bulk pass; ongoing re-embed coverage is handled by the
 * recurring-sync path (webhooks + cron tick).
 */

interface Args {
  shop: string;
  dryRun: boolean;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  let shop: string | undefined;
  let dryRun = false;
  for (const arg of argv) {
    if (arg.startsWith("--shop=")) shop = arg.slice("--shop=".length);
    else if (arg === "--dry-run") dryRun = true;
    else if (arg === "--help" || arg === "-h") {
      console.log("Usage: tsx scripts/bulk-reembed-products.ts --shop=<domain> [--dry-run]");
      process.exit(0);
    } else {
      console.error(`Unknown arg: ${arg}`);
      process.exit(1);
    }
  }
  if (!shop) {
    console.error("Missing required --shop=<domain>");
    process.exit(1);
  }
  return { shop, dryRun };
}

async function main() {
  const { shop, dryRun } = parseArgs();
  const prisma = new PrismaClient();
  const startedAt = new Date();

  const targets = await prisma.product.findMany({
    where: {
      shopDomain: shop,
      embeddingContentHash: null,
      status: "ACTIVE",
      deletedAt: null,
      recommendationExcluded: false,
    },
    select: { id: true, handle: true },
  });

  console.log(JSON.stringify({
    phase: "pre-insert",
    shop,
    dryRun,
    targetCount: targets.length,
    startedAt: startedAt.toISOString(),
  }, null, 2));

  if (dryRun) {
    console.log(JSON.stringify({
      phase: "dry-run-complete",
      wouldEnqueue: targets.length,
      sampleHandles: targets.slice(0, 5).map((t) => t.handle),
    }, null, 2));
    await prisma.$disconnect();
    return;
  }

  const result = await prisma.taggingJob.createMany({
    data: targets.map((t) => ({
      kind: "RE_EMBED" as const,
      shopDomain: shop,
      productId: t.id,
      status: "QUEUED" as const,
      triggerSource: "INITIAL_BACKFILL",
    })),
    skipDuplicates: true,
  });

  const completedAt = new Date();

  console.log(JSON.stringify({
    phase: "post-insert",
    requested: targets.length,
    inserted: result.count,
    duplicatesSkipped: targets.length - result.count,
    completedAt: completedAt.toISOString(),
    durationMs: completedAt.getTime() - startedAt.getTime(),
  }, null, 2));

  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
