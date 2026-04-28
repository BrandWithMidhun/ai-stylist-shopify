// Phase 1 (PR-B): post-INITIAL-backfill verifier.
//
// Usage:
//   npx tsx scripts/verify-initial-run.ts <shopDomain>
//
// What it asserts:
//   1. DB Product count (live, deletedAt IS NULL) exactly matches
//      Shopify productsCount. Tolerance 0 — if a webhook drift makes
//      these diverge, the job didn't fully reconcile and we want a
//      hard failure here, not a soft warning.
//   2. Every live Product row has a non-null knowledgeContentHash.
//   3. Every live Product row has a non-null lastKnowledgeSyncAt.
//   4. MerchantConfig.lastKnowledgeSyncAt for the shop is >= the
//      enqueuedAt of the most recent SUCCEEDED INITIAL/MANUAL_RESYNC
//      job for that shop. Wall-clock freshness ("within last N min")
//      is fragile — the verifier may run minutes or hours after the
//      job finished. The invariant we actually care about is "the
//      FINALIZE phase of the latest successful full re-ingest
//      committed its MerchantConfig write."
//   5. Spot-checks: 3 random products with metafields, 3 with metaobject
//      references, 3 in multiple collections — verify the joined rows
//      really exist for each.
//
// PASS / FAIL / SKIP semantics:
//   SKIP indicates the assertion has no testable candidates in the
//   current catalog state. The worker contract is "ingest what
//   exists" — vacuous truth on empty inputs is correct behavior.
//   SKIP differs from FAIL in that it asserts no negative finding:
//   it's not "the worker did the wrong thing," it's "the catalog
//   doesn't contain what this assertion would test." The metaobject
//   and multi-collection spot-checks SKIP when no candidate rows
//   exist for the shop; the metafield spot-check stays strict
//   because the worker writes ProductMetafield rows on every product
//   that has any metafields, and zero candidates here would indicate
//   a real ingestion bug.
//
// Output: structured PASS/FAIL/SKIP table per assertion, then a
// counts summary, then an overall PASS/FAIL header. Exit code 0 if
// no FAIL (any number of SKIPs is fine), 1 if any FAIL, 2 on usage
// error.

import prisma from "../app/db.server";
import { unauthenticated } from "../app/shopify.server";
import {
  PRODUCTS_COUNT_QUERY,
  type ProductsCountResponse,
} from "../app/lib/catalog/graphql.server";

type AssertionStatus = "PASS" | "FAIL" | "SKIP";

type AssertionResult = {
  name: string;
  status: AssertionStatus;
  expected: string;
  actual: string;
  detail?: string;
};

const results: AssertionResult[] = [];

function record(
  name: string,
  expected: unknown,
  actual: unknown,
  status: AssertionStatus,
  detail?: string,
): void {
  results.push({
    name,
    status,
    expected: String(expected),
    actual: String(actual),
    detail,
  });
}

function passOrFail(passed: boolean): AssertionStatus {
  return passed ? "PASS" : "FAIL";
}

async function fetchShopifyProductCount(shopDomain: string): Promise<number> {
  const { admin } = await unauthenticated.admin(shopDomain);
  const response = await admin.graphql(PRODUCTS_COUNT_QUERY);
  const payload = (await response.json()) as {
    data?: ProductsCountResponse;
    errors?: unknown;
  };
  if (!payload.data?.productsCount) {
    throw new Error(
      `Shopify productsCount returned no data: ${JSON.stringify(payload).slice(0, 500)}`,
    );
  }
  return payload.data.productsCount.count;
}

async function spotCheckMetafields(shopDomain: string): Promise<void> {
  const samples = await prisma.$queryRaw<Array<{ id: string; title: string }>>`
    SELECT p.id, p.title
    FROM "Product" p
    WHERE p."shopDomain" = ${shopDomain}
      AND p."deletedAt" IS NULL
      AND EXISTS (
        SELECT 1 FROM "ProductMetafield" pm WHERE pm."productId" = p.id
      )
    ORDER BY RANDOM()
    LIMIT 3
  `;
  if (samples.length === 0) {
    // Stays strict: zero metafield-bearing products on a non-empty
    // catalog signals a worker malfunction (the metafield ingest path
    // dropped every row), not a property of the catalog. FAIL.
    record(
      "Spot-check metafields: at least one product with metafields",
      ">=1",
      0,
      "FAIL",
      "No products with any ProductMetafield rows found — likely worker malfunction",
    );
    return;
  }
  for (const p of samples) {
    const count = await prisma.productMetafield.count({
      where: { productId: p.id },
    });
    record(
      `Spot-check metafields: ${truncate(p.title, 40)}`,
      ">=1 ProductMetafield row",
      `${count} rows`,
      passOrFail(count >= 1),
    );
  }
}

async function spotCheckMetaobjects(shopDomain: string): Promise<void> {
  // EXISTS subquery instead of JOIN + DISTINCT — Postgres rejects
  // `SELECT DISTINCT ... ORDER BY RANDOM()` (RANDOM() isn't in the
  // select list, code 42P10). EXISTS gives the same "at least one
  // metaobject-typed reference" semantics with no need for DISTINCT.
  const samples = await prisma.$queryRaw<Array<{ id: string; title: string }>>`
    SELECT p.id, p.title
    FROM "Product" p
    WHERE p."shopDomain" = ${shopDomain}
      AND p."deletedAt" IS NULL
      AND EXISTS (
        SELECT 1
        FROM "ProductMetafield" pm
        INNER JOIN "Metaobject" mo
          ON mo."shopifyId" = pm."referenceGid"
          AND mo."shopDomain" = pm."shopDomain"
        WHERE pm."productId" = p.id
      )
    ORDER BY RANDOM()
    LIMIT 3
  `;
  if (samples.length === 0) {
    // SKIP: a shop with zero metaobject definitions has zero
    // metaobject_reference metafields, hence zero linkages. The
    // worker correctly does nothing in that case.
    record(
      "Spot-check metaobject linkages",
      "candidate products with metaobject linkages",
      "0 candidates",
      "SKIP",
      "shop has no metaobject linkages — vacuously satisfied",
    );
    return;
  }
  for (const p of samples) {
    const linkageRows = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(DISTINCT pm."referenceGid")::bigint AS count
      FROM "ProductMetafield" pm
      INNER JOIN "Metaobject" mo
        ON mo."shopifyId" = pm."referenceGid"
        AND mo."shopDomain" = pm."shopDomain"
      WHERE pm."productId" = ${p.id}
    `;
    const linkages = Number(linkageRows[0]?.count ?? 0n);
    record(
      `Spot-check metaobjects: ${truncate(p.title, 40)}`,
      ">=1 metaobject linkage",
      `${linkages} linkages`,
      passOrFail(linkages >= 1),
    );
  }
}

async function spotCheckMultiCollection(shopDomain: string): Promise<void> {
  const samples = await prisma.$queryRaw<Array<{ id: string; title: string }>>`
    SELECT p.id, p.title
    FROM "Product" p
    WHERE p."shopDomain" = ${shopDomain}
      AND p."deletedAt" IS NULL
      AND (
        SELECT COUNT(*) FROM "ProductCollection" pc WHERE pc."productId" = p.id
      ) > 1
    ORDER BY RANDOM()
    LIMIT 3
  `;
  if (samples.length === 0) {
    // SKIP: a shop where no product is in 2+ collections — common on
    // dev seed catalogs and on small live catalogs — has nothing to
    // verify. The worker writes ProductCollection rows for whatever
    // memberships exist; vacuous truth on a zero-overlap catalog.
    record(
      "Spot-check multi-collection",
      "candidate products in 2+ collections",
      "0 candidates",
      "SKIP",
      "shop has no multi-collection products — vacuously satisfied",
    );
    return;
  }
  for (const p of samples) {
    const count = await prisma.productCollection.count({
      where: { productId: p.id },
    });
    record(
      `Spot-check collections: ${truncate(p.title, 40)}`,
      ">=2 ProductCollection rows",
      `${count} rows`,
      passOrFail(count >= 2),
    );
  }
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + "…";
}

function printResults(shopDomain: string): boolean {
  const passCount = results.filter((r) => r.status === "PASS").length;
  const failCount = results.filter((r) => r.status === "FAIL").length;
  const skipCount = results.filter((r) => r.status === "SKIP").length;
  const allPassed = failCount === 0;
  // eslint-disable-next-line no-console
  console.log("");
  // eslint-disable-next-line no-console
  console.log(`Verification results for shop: ${shopDomain}`);
  // eslint-disable-next-line no-console
  console.log("=".repeat(80));
  for (const r of results) {
    // eslint-disable-next-line no-console
    console.log(`[${r.status}] ${r.name}`);
    // eslint-disable-next-line no-console
    console.log(`        expected: ${r.expected}`);
    // eslint-disable-next-line no-console
      console.log(`        actual:   ${r.actual}`);
    if (r.detail) {
      // eslint-disable-next-line no-console
      console.log(`        note:     ${r.detail}`);
    }
  }
  // eslint-disable-next-line no-console
  console.log("=".repeat(80));
  // eslint-disable-next-line no-console
  console.log(
    `SUMMARY: ${passCount} PASS, ${failCount} FAIL, ${skipCount} SKIP`,
  );
  // eslint-disable-next-line no-console
  console.log(`OVERALL: ${allPassed ? "PASS" : "FAIL"}`);
  return allPassed;
}

async function main(): Promise<void> {
  // eslint-disable-next-line no-undef
  const shopDomain = process.argv[2]?.trim();
  if (!shopDomain) {
    // eslint-disable-next-line no-console
    console.error("usage: npx tsx scripts/verify-initial-run.ts <shopDomain>");
    // eslint-disable-next-line no-undef
    process.exit(2);
  }

  // 1. Counts.
  const shopifyCount = await fetchShopifyProductCount(shopDomain);
  const dbCount = await prisma.product.count({
    where: { shopDomain, deletedAt: null },
  });
  record(
    "DB live Product count matches Shopify productsCount",
    `${shopifyCount}`,
    `${dbCount}`,
    passOrFail(shopifyCount > 0 && shopifyCount === dbCount),
    shopifyCount === 0 ? "Shopify reports zero products" : undefined,
  );

  // 2-3. Required-field coverage.
  const missingHash = await prisma.product.count({
    where: { shopDomain, deletedAt: null, knowledgeContentHash: null },
  });
  record(
    "Every live Product has knowledgeContentHash IS NOT NULL",
    "0 missing",
    `${missingHash} missing`,
    passOrFail(missingHash === 0),
  );
  const missingLastSync = await prisma.product.count({
    where: { shopDomain, deletedAt: null, lastKnowledgeSyncAt: null },
  });
  record(
    "Every live Product has lastKnowledgeSyncAt IS NOT NULL",
    "0 missing",
    `${missingLastSync} missing`,
    passOrFail(missingLastSync === 0),
  );

  // 4. MerchantConfig.lastKnowledgeSyncAt was bumped by the latest
  //    SUCCEEDED INITIAL/MANUAL_RESYNC. Compared against that job's
  //    enqueuedAt rather than wall-clock — see top-of-file rationale.
  const config = await prisma.merchantConfig.findUnique({
    where: { shop: shopDomain },
    select: { lastKnowledgeSyncAt: true },
  });
  const baselineRun = await prisma.catalogSyncJob.findFirst({
    where: {
      shopDomain,
      kind: { in: ["INITIAL", "MANUAL_RESYNC"] },
      status: "SUCCEEDED",
    },
    orderBy: { enqueuedAt: "desc" },
    select: { id: true, kind: true, enqueuedAt: true },
  });
  if (!baselineRun) {
    record(
      "MerchantConfig.lastKnowledgeSyncAt bumped by latest successful INITIAL/MANUAL_RESYNC",
      "baseline SUCCEEDED INITIAL/MANUAL_RESYNC job exists",
      "none found",
      "FAIL",
      "No SUCCEEDED INITIAL or MANUAL_RESYNC job for this shop; nothing to compare against. Enqueue an INITIAL and re-run.",
    );
  } else {
    const last = config?.lastKnowledgeSyncAt;
    const baseline = baselineRun.enqueuedAt;
    const passed = Boolean(last && last.getTime() >= baseline.getTime());
    record(
      `MerchantConfig.lastKnowledgeSyncAt >= enqueuedAt of latest SUCCEEDED ${baselineRun.kind}`,
      `>= ${baseline.toISOString()} (job ${baselineRun.id})`,
      last ? last.toISOString() : "null",
      passOrFail(passed),
    );
  }

  // 5. Spot checks.
  await spotCheckMetafields(shopDomain);
  await spotCheckMetaobjects(shopDomain);
  await spotCheckMultiCollection(shopDomain);

  const allPassed = printResults(shopDomain);
  // eslint-disable-next-line no-undef
  process.exit(allPassed ? 0 : 1);
}

main()
  .catch(async (err) => {
    // eslint-disable-next-line no-console
    console.error("[verify-initial-run] fatal:", err);
    // eslint-disable-next-line no-undef
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => {});
  });
