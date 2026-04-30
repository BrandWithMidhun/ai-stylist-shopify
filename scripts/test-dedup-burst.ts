// Phase 1 (PR-C, C.2 Addition 3): dedup burst test for the
// enqueueDeltaForShop helper.
//
// Purpose: verify Q3 option b (application-level dedup) actually
// collapses bursts of webhook deliveries into a single QUEUED DELTA.
//
// Behavior:
//   1. Drain or skip if a DELTA is already QUEUED for the shop —
//      we want a clean baseline so the dedup count is unambiguous.
//   2. Fire 5 enqueueDeltaForShop calls in sequence (sequential, not
//      parallel — sequential is the truer model of webhook delivery
//      since Shopify itself doesn't fan out concurrent deliveries
//      faster than network roundtrip).
//   3. Each call uses the same shop + same topic + distinct resourceGid
//      (so log lines distinguish them).
//   4. Assert: exactly 1 of 5 returns deduped=false; the other 4 return
//      deduped=true with the same jobId.
//   5. Cross-check: query CatalogSyncJob — exactly 1 QUEUED DELTA row
//      for the shop.
//
// Usage:
//   npx tsx scripts/test-dedup-burst.ts <shopDomain>
//
// Exit codes:
//   0 — dedup behaves correctly
//   1 — assertion failed (real duplicates created — investigate)
//   2 — usage error or pre-existing QUEUED DELTA (run again later)

import prisma from "../app/db.server";
import { enqueueDeltaForShop } from "../app/lib/webhooks/enqueue-delta.server";

async function main(): Promise<void> {
  // eslint-disable-next-line no-undef
  const shop = process.argv[2]?.trim();
  if (!shop) {
    // eslint-disable-next-line no-console
    console.error("usage: npx tsx scripts/test-dedup-burst.ts <shopDomain>");
    // eslint-disable-next-line no-undef
    process.exit(2);
  }

  const preExisting = await prisma.catalogSyncJob.findMany({
    where: { shopDomain: shop, kind: "DELTA", status: "QUEUED" },
    select: { id: true, enqueuedAt: true },
  });
  if (preExisting.length > 0) {
    // eslint-disable-next-line no-console
    console.error(
      `[test-dedup-burst] pre-existing QUEUED DELTA(s) for ${shop}: ${preExisting
        .map((j) => j.id)
        .join(", ")}. Wait for the worker to drain or delete the test rows manually.`,
    );
    // eslint-disable-next-line no-undef
    process.exit(2);
  }

  const results: Array<{ jobId: string; deduped: boolean }> = [];
  for (let i = 0; i < 5; i++) {
    const r = await enqueueDeltaForShop(shop, {
      topic: "products/update",
      webhookId: `test-burst-${Date.now()}-${i}`,
      resourceGid: `gid://shopify/Product/test-burst-${i}`,
    });
    results.push(r);
  }

  const queuedAfter = await prisma.catalogSyncJob.findMany({
    where: { shopDomain: shop, kind: "DELTA", status: "QUEUED" },
    select: { id: true, enqueuedAt: true },
  });

  const dedupedCount = results.filter((r) => r.deduped).length;
  const freshCount = results.filter((r) => !r.deduped).length;
  const uniqueJobIds = new Set(results.map((r) => r.jobId));

  const summary = {
    shop,
    burstSize: results.length,
    dedupedCount,
    freshCount,
    uniqueJobIds: Array.from(uniqueJobIds),
    queuedDeltaRowsAfter: queuedAfter.length,
    queuedDeltaIds: queuedAfter.map((j) => j.id),
    perCall: results,
  };

  // eslint-disable-next-line no-console
  console.log(JSON.stringify(summary, null, 2));

  const ok =
    freshCount === 1 &&
    dedupedCount === 4 &&
    uniqueJobIds.size === 1 &&
    queuedAfter.length === 1;
  if (!ok) {
    // eslint-disable-next-line no-console
    console.error("[test-dedup-burst] FAIL — dedup did not collapse burst as expected");
    // eslint-disable-next-line no-undef
    process.exit(1);
  }
  // eslint-disable-next-line no-console
  console.log("[test-dedup-burst] PASS");
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (err) => {
    // eslint-disable-next-line no-console
    console.error("[test-dedup-burst] fatal:", err);
    await prisma.$disconnect().catch(() => {});
    // eslint-disable-next-line no-undef
    process.exit(1);
  });
