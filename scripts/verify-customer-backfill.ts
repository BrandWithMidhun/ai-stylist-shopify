// PR-D D.3: post-customer-backfill verifier.
//
// Usage:
//   npx tsx scripts/verify-customer-backfill.ts <shopDomain>
//
// What it asserts:
//   1. CustomerProfile count (live, deletedAt IS NULL) matches
//      Shopify customersCount.
//        - precision EXACT       → exact equality required.
//        - precision AT_LEAST or AT_LEAST_APPROXIMATE → tolerance
//          5% (Shopify is reporting "at least N"; the DB count must
//          be within 5% of N or be >= N).
//   2. CustomerEvent(kind=ORDER_PLACED) count for the shop's profiles
//      matches Shopify ordersCount over the same 90d window
//      (created_at:>=YYYY-MM-DD). Same precision-based tolerance.
//   3. At least one CustomerProfile has at least one
//      CustomerEvent(ORDER_PLACED) — confirms the order-side of the
//      backfill end-to-end. SKIPPED when shopifyOrderCount is 0.
//
// Output: PASS/FAIL/SKIP table per assertion + counts summary +
// overall PASS/FAIL header. Exit 0 on PASS, 1 on FAIL, 2 on usage
// error.

import prisma from "../app/db.server";
import { unauthenticated } from "../app/shopify.server";
import {
  CUSTOMERS_COUNT_QUERY,
  ORDERS_COUNT_QUERY,
  type CustomersCountResponse,
  type OrdersCountResponse,
  type CountPrecision,
  type GqlCount,
} from "../app/lib/catalog/queries/customers.server";

type AssertionStatus = "PASS" | "FAIL" | "SKIP";

type AssertionResult = {
  name: string;
  status: AssertionStatus;
  expected: string;
  actual: string;
  detail?: string;
};

const TOLERANCE_FRACTION = 0.05;
const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

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

// Tolerance test for non-exact precisions. We accept dbCount within
// ±5% of shopifyCount, OR dbCount >= shopifyCount (precision AT_LEAST
// means "at least N", so any DB count >= N is consistent).
function withinTolerance(dbCount: number, shopifyCount: number): boolean {
  if (dbCount >= shopifyCount) return true;
  if (shopifyCount === 0) return dbCount === 0;
  const ratio = Math.abs(dbCount - shopifyCount) / shopifyCount;
  return ratio <= TOLERANCE_FRACTION;
}

function describePrecision(p: CountPrecision): string {
  return p === "EXACT" ? "EXACT" : `${p} (5% tolerance)`;
}

function evaluateCount(
  name: string,
  shopify: GqlCount,
  dbCount: number,
): void {
  if (shopify.precision === "EXACT") {
    record(
      name,
      `${shopify.count} (EXACT)`,
      String(dbCount),
      passOrFail(dbCount === shopify.count),
    );
    return;
  }
  record(
    name,
    `${shopify.count} (${describePrecision(shopify.precision)})`,
    String(dbCount),
    passOrFail(withinTolerance(dbCount, shopify.count)),
    `tolerance band: db within 5% of shopify, or db >= shopify (AT_LEAST semantics)`,
  );
}

async function fetchShopifyCustomersCount(
  shopDomain: string,
): Promise<GqlCount> {
  const { admin } = await unauthenticated.admin(shopDomain);
  const response = await admin.graphql(CUSTOMERS_COUNT_QUERY);
  const payload = (await response.json()) as {
    data?: CustomersCountResponse;
    errors?: Array<{ message: string }>;
  };
  if (payload.errors?.length) {
    throw new Error(
      `customersCount GraphQL errors: ${JSON.stringify(payload.errors)}`,
    );
  }
  if (!payload.data?.customersCount) {
    throw new Error(
      `customersCount returned no data: ${JSON.stringify(payload).slice(0, 500)}`,
    );
  }
  return payload.data.customersCount;
}

async function fetchShopifyOrdersCount(
  shopDomain: string,
  filter: string,
): Promise<GqlCount> {
  const { admin } = await unauthenticated.admin(shopDomain);
  const response = await admin.graphql(ORDERS_COUNT_QUERY, {
    variables: { query: filter },
  });
  const payload = (await response.json()) as {
    data?: OrdersCountResponse;
    errors?: Array<{ message: string }>;
  };
  if (payload.errors?.length) {
    throw new Error(
      `ordersCount GraphQL errors: ${JSON.stringify(payload.errors)}`,
    );
  }
  if (!payload.data?.ordersCount) {
    throw new Error(
      `ordersCount returned no data: ${JSON.stringify(payload).slice(0, 500)}`,
    );
  }
  return payload.data.ordersCount;
}

function ninetyDaysAgoISODate(): string {
  return new Date(Date.now() - NINETY_DAYS_MS).toISOString().slice(0, 10);
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
    console.error(
      "usage: npx tsx scripts/verify-customer-backfill.ts <shopDomain>",
    );
    // eslint-disable-next-line no-undef
    process.exit(2);
  }

  const filter = `created_at:>=${ninetyDaysAgoISODate()}`;

  // 1. Customer count parity.
  const shopifyCustomers = await fetchShopifyCustomersCount(shopDomain);
  const dbCustomerCount = await prisma.customerProfile.count({
    where: { shopDomain, deletedAt: null },
  });
  evaluateCount(
    "CustomerProfile count matches Shopify customersCount",
    shopifyCustomers,
    dbCustomerCount,
  );

  // 2. ORDER_PLACED event count parity for the 90d window.
  const shopifyOrders = await fetchShopifyOrdersCount(shopDomain, filter);
  const dbOrderEventCount = await prisma.customerEvent.count({
    where: {
      shopDomain,
      kind: "ORDER_PLACED",
      profile: { shopDomain, deletedAt: null },
    },
  });
  evaluateCount(
    `ORDER_PLACED event count matches Shopify ordersCount (${filter})`,
    shopifyOrders,
    dbOrderEventCount,
  );

  // 3. End-to-end: at least one profile has at least one ORDER_PLACED.
  if (shopifyOrders.count === 0) {
    record(
      "At least one CustomerProfile has at least one ORDER_PLACED event",
      "skipped (Shopify reports 0 orders in window)",
      "n/a",
      "SKIP",
      "empty-order shop is a valid state; vacuously satisfied",
    );
  } else {
    const profilesWithOrder = await prisma.customerProfile.count({
      where: {
        shopDomain,
        deletedAt: null,
        events: { some: { kind: "ORDER_PLACED" } },
      },
    });
    record(
      "At least one CustomerProfile has at least one ORDER_PLACED event",
      ">= 1",
      String(profilesWithOrder),
      passOrFail(profilesWithOrder >= 1),
    );
  }

  const allPassed = printResults(shopDomain);
  // eslint-disable-next-line no-undef
  process.exit(allPassed ? 0 : 1);
}

main()
  .catch(async (err) => {
    // eslint-disable-next-line no-console
    console.error("[verify-customer-backfill] fatal:", err);
    // eslint-disable-next-line no-undef
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => {});
  });
