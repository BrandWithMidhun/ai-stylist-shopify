// Phase 1 (PR-B): manual enqueue of an INITIAL CatalogSyncJob.
//
// Usage:
//   npx tsx scripts/enqueue-initial.ts <shopDomain>
//
// Production-only by design: there is no env fallback for the shop
// argument. Refuses to enqueue for a shop that has no MerchantConfig
// row — that would just create an orphan job the worker can't run.
//
// Output is a single JSON object with {jobId, shopDomain, queuedAt,
// status}. Exit codes:
//   0 — job created
//   1 — fatal error (DB unreachable, MerchantConfig missing, etc.)
//   2 — usage error (missing/empty shop arg)

import prisma from "../app/db.server";
import { createJob } from "../app/lib/catalog/sync-jobs.server";

async function main(): Promise<void> {
  // eslint-disable-next-line no-undef
  const shopDomain = process.argv[2]?.trim();
  if (!shopDomain) {
    // eslint-disable-next-line no-console
    console.error("usage: npx tsx scripts/enqueue-initial.ts <shopDomain>");
    // eslint-disable-next-line no-undef
    process.exit(2);
  }

  const config = await prisma.merchantConfig.findUnique({
    where: { shop: shopDomain },
    select: { id: true, shop: true },
  });
  if (!config) {
    // eslint-disable-next-line no-console
    console.error(
      `[enqueue-initial] MerchantConfig not found for shop "${shopDomain}". ` +
        `Refusing to enqueue an INITIAL job for an unknown shop.`,
    );
    // eslint-disable-next-line no-undef
    process.exit(1);
  }

  const job = await createJob({ shopDomain, kind: "INITIAL" });

  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify(
      {
        jobId: job.id,
        shopDomain: job.shopDomain,
        queuedAt: job.enqueuedAt.toISOString(),
        status: job.status,
      },
      null,
      2,
    ),
  );
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (err) => {
    // eslint-disable-next-line no-console
    console.error("[enqueue-initial] fatal:", err);
    await prisma.$disconnect().catch(() => {});
    // eslint-disable-next-line no-undef
    process.exit(1);
  });
