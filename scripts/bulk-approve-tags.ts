import "dotenv/config";
import { PrismaClient } from "@prisma/client";

// Bulk-approve ProductTag rows from PENDING_REVIEW → APPROVED for a given
// shopDomain and axis set. Bridge mechanism for the Phase 2 → Phase 3 APPROVED-tag
// gap: PR-2.2 ships AI-tagged rows in PENDING_REVIEW; Phase 4 portal will let
// merchants approve via UI; until then, this script is the canonical interim
// approval path.
//
// First use case: Sub-bundle 3.1 mech.6 baseline preparation against
// ai-fashion-store.myshopify.com on (gender, category). Captured at
// .pr-3-1-mech-6-artifacts/bulk-approve-real-run.txt.
//
// Future use cases: Phase 5 multi-shop onboarding (parameterize --shop and
// --axes per shop), targeted re-approval after rule-engine vocabulary changes.
//
// Idempotent: PENDING_REVIEW only; already-APPROVED rows are skipped. Re-runs
// are no-ops on rows in any non-PENDING_REVIEW status.
// Safe: skips locked=true rows; only operates on declared --axes.
// Forensic: writes one ProductTagAudit row per flip with action="APPROVE",
// previousValue="PENDING_REVIEW", newValue="APPROVED", actorId from --actor-id
// (default "system://manual-bulk-approve").
//
// Usage:
//   tsx scripts/bulk-approve-tags.ts --shop=<domain> --axes=<csv> [--dry-run] [--actor-id=<id>]
//
// Defaults:
//   --shop      ai-fashion-store.myshopify.com
//   --axes      gender,category
//   --actor-id  system://manual-bulk-approve

const DEFAULT_SHOP = "ai-fashion-store.myshopify.com";
const DEFAULT_AXES = ["gender", "category"];
const DEFAULT_ACTOR_ID = "system://manual-bulk-approve";

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

const { shop: SHOP, axes: TARGET_AXES, actorId: ACTOR_ID, dryRun: DRY_RUN } = parseArgs();

const prisma = new PrismaClient();

async function snapshot(label: string) {
  const counts: Record<string, Record<string, number>> = {};
  for (const axis of TARGET_AXES) {
    const grouped = await prisma.productTag.groupBy({
      by: ["status"],
      where: { shopDomain: SHOP, axis },
      _count: { _all: true },
    });
    counts[axis] = {};
    for (const row of grouped) {
      counts[axis][row.status] = row._count._all;
    }
  }

  // Eligibility: products with APPROVED tags on EVERY axis in TARGET_AXES.
  // Intersect productId sets across axes via Set.reduce. One findMany per
  // axis keeps the shape readable and lines up with the per-axis counts
  // we print below.
  const approvedSets: Array<{ axis: string; ids: Set<string> }> = [];
  for (const axis of TARGET_AXES) {
    const rows = await prisma.productTag.findMany({
      where: { shopDomain: SHOP, axis, status: "APPROVED" },
      distinct: ["productId"],
      select: { productId: true },
    });
    approvedSets.push({ axis, ids: new Set(rows.map((r) => r.productId)) });
  }
  const intersection: Set<string> =
    approvedSets.length === 0
      ? new Set()
      : approvedSets.reduce<Set<string>>((acc, cur, idx) => {
          if (idx === 0) return new Set(cur.ids);
          const next = new Set<string>();
          for (const id of acc) if (cur.ids.has(id)) next.add(id);
          return next;
        }, new Set());

  console.log(`\n=== ${label} ===`);
  console.log(`ProductTag counts by (axis, status):`);
  for (const axis of TARGET_AXES) {
    console.log(`  ${axis}:`);
    for (const [status, count] of Object.entries(counts[axis] ?? {})) {
      console.log(`    ${status}: ${count}`);
    }
  }
  console.log(`Eligibility by intersection of all axes:`);
  for (const { axis, ids } of approvedSets) {
    console.log(`  APPROVED ${axis}:    ${ids.size}`);
  }
  console.log(`  Intersection:       ${intersection.size}`);

  return { counts, eligibleCount: intersection.size };
}

async function main() {
  console.log(`shopDomain:  ${SHOP}`);
  console.log(`targetAxes:  ${TARGET_AXES.join(", ")}`);
  console.log(`actorId:     ${ACTOR_ID}`);
  console.log(`dryRun:      ${DRY_RUN}`);

  await snapshot("BEFORE");

  // Find every ProductTag we'd flip
  const candidates = await prisma.productTag.findMany({
    where: {
      shopDomain: SHOP,
      axis: { in: TARGET_AXES },
      status: "PENDING_REVIEW",
      locked: false,
    },
    select: {
      id: true,
      productId: true,
      axis: true,
      value: true,
      source: true,
    },
  });

  console.log(`\nCandidates to approve: ${candidates.length}`);
  if (candidates.length === 0) {
    console.log("Nothing to do.");
    await snapshot("AFTER (no-op)");
    await prisma.$disconnect();
    return;
  }

  if (DRY_RUN) {
    console.log("\n--dry-run: skipping writes. Sample of first 5 candidates:");
    for (const c of candidates.slice(0, 5)) {
      console.log(`  ${c.id}: productId=${c.productId} axis=${c.axis} value=${c.value} source=${c.source}`);
    }
    await prisma.$disconnect();
    return;
  }

  // Batch in groups of 50 transactions
  const BATCH = 50;
  let done = 0;
  for (let i = 0; i < candidates.length; i += BATCH) {
    const batch = candidates.slice(i, i + BATCH);
    const ops = batch.flatMap((c) => [
      prisma.productTag.update({
        where: { id: c.id },
        data: {
          status: "APPROVED",
          reviewedAt: new Date(),
          // reviewedBy intentionally left NULL — column is documented as
          // Shopify staff GID; SYSTEM is recorded on ProductTagAudit instead.
        },
      }),
      prisma.productTagAudit.create({
        data: {
          productId: c.productId,
          shopDomain: SHOP,
          axis: c.axis,
          action: "APPROVE",
          previousValue: "PENDING_REVIEW",
          newValue: "APPROVED",
          source: c.source,
          actorId: ACTOR_ID,
        },
      }),
    ]);
    await prisma.$transaction(ops);
    done += batch.length;
    console.log(`  flipped ${done}/${candidates.length}`);
  }

  await snapshot("AFTER");
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
