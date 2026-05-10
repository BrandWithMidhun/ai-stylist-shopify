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
//   tsx scripts/bulk-approve-tags.ts --shop=<domain> --axes=<csv> [--dry-run] [--actor-id=<id>] [--min-confidence=<float>]
//
// Defaults:
//   --shop             ai-fashion-store.myshopify.com
//   --axes             gender,category
//   --actor-id         system://manual-bulk-approve
//   --min-confidence   0 (no confidence filter; preserves 3.1 mech.6 idiom)
//
// --min-confidence (mech.3a, 3.1.7): when > 0, restricts the candidate
// set to ProductTag rows where confidence >= <float>. NULL-confidence
// rows are EXCLUDED at any threshold > 0 (NULL fails Prisma's gte).
// Use 0.8 to mirror the AI-tagger's "high-confidence" cutoff per
// 3.1.7 mech.3 D1. Use 0 (default) for full review-state-trust
// approval mirroring 3.1 mech.6's (gender, category) baseline.

const DEFAULT_SHOP = "ai-fashion-store.myshopify.com";
const DEFAULT_AXES = ["gender", "category"];
const DEFAULT_ACTOR_ID = "system://manual-bulk-approve";

function parseArgs(): {
  shop: string;
  axes: string[];
  actorId: string;
  dryRun: boolean;
  minConfidence: number;
} {
  let shop = DEFAULT_SHOP;
  let axes = DEFAULT_AXES;
  let actorId = DEFAULT_ACTOR_ID;
  let dryRun = false;
  let minConfidence = 0; // mech.3a D1: 0 = no filter, preserves backward-compat

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
    } else if (arg.startsWith("--min-confidence=")) {
      const v = arg.slice("--min-confidence=".length).trim();
      const parsed = Number(v);
      if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 1) {
        minConfidence = parsed;
      } else {
        // mech.3a D1: invalid values fail-loud rather than silently
        // defaulting. The CLI is forensic; an unparseable threshold
        // should surface, not be ignored.
        console.error(
          `Invalid --min-confidence value: ${v}. Must be a number in [0, 1].`,
        );
        process.exit(1);
      }
    }
  }
  return { shop, axes, actorId, dryRun, minConfidence };
}

const {
  shop: SHOP,
  axes: TARGET_AXES,
  actorId: ACTOR_ID,
  dryRun: DRY_RUN,
  minConfidence: MIN_CONFIDENCE,
} = parseArgs();

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
  console.log(`shopDomain:    ${SHOP}`);
  console.log(`targetAxes:    ${TARGET_AXES.join(", ")}`);
  console.log(`actorId:       ${ACTOR_ID}`);
  console.log(`dryRun:        ${DRY_RUN}`);
  console.log(`minConfidence: ${MIN_CONFIDENCE}`);

  await snapshot("BEFORE");

  // Find every ProductTag we'd flip
  const candidates = await prisma.productTag.findMany({
    where: {
      shopDomain: SHOP,
      axis: { in: TARGET_AXES },
      status: "PENDING_REVIEW",
      locked: false,
      // mech.3a D1: filter by AI-tagger confidence when --min-confidence > 0.
      // NULL confidence rows are EXCLUDED by Prisma's gte (NULL fails the
      // comparison) — that's intentional. NULL means "AI tagger didn't
      // record a confidence" which we treat as "do not approve at this
      // threshold; revisit when reviewer sees the row." When MIN_CONFIDENCE
      // is 0, the predicate is omitted entirely so existing 3.1 mech.6-style
      // invocations stay byte-for-byte identical.
      ...(MIN_CONFIDENCE > 0
        ? { confidence: { gte: MIN_CONFIDENCE } }
        : {}),
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
