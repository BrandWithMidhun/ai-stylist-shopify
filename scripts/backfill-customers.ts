// PR-D D.3: customer + 90-day order backfill.
//
// Usage:
//   npx tsx scripts/backfill-customers.ts <shopDomain>
//
// What it does:
//   1. Iterates every Customer in the merchant's Shopify shop via
//      cursor pagination (CUSTOMERS_PAGE_QUERY).
//   2. For each customer, upserts a CustomerProfile row keyed on
//      (shopDomain, shopifyCustomerId). Re-runs are safe: D.1's
//      upsert helper resurrects soft-deleted rows and updates
//      mutable attributes.
//   3. For each customer, fetches orders created within the last 90
//      days (CUSTOMER_ORDERS_QUERY) and writes one CustomerEvent
//      row per order with kind=ORDER_PLACED.
//
// Idempotency:
//   - CustomerProfile: keyed upsert (PK-style, see upsert.server.ts).
//   - CustomerEvent (ORDER_PLACED): existence-check on
//     (profileId, kind=ORDER_PLACED, context->>'orderGid' = orderGid)
//     before insert. Application-level dedup is sufficient for the
//     backfill's serial pace; concurrent re-runs against the same
//     shop are not a supported workflow.
//
// 90d window:
//   - Computed at script start as YYYY-MM-DD (UTC). Embedded into
//     Shopify order search via the `created_at:>=<date>` syntax. The
//     filter string itself is passed as a $query GraphQL variable.
//   - Shopify's order visibility defaults to 60 days for stores
//     without read_all_orders. If we detect the response missing
//     orders older than ~60 days while the customer's profile shows
//     an older creation date with an order count > 0, we log a
//     one-time WARN. Hard failure is not appropriate — the dev shop
//     may legitimately not have read_all_orders, and the backfill
//     should still seed what it can see.
//
// Exit codes:
//   0 — completed without fatal error (per-customer/per-order failures
//       are logged and counted, not exit-1).
//   1 — fatal (DB unreachable, MerchantConfig missing, GraphQL auth
//       failure, throttle backoff exhaustion, etc.).
//   2 — usage error (missing/invalid shopDomain).
//
// Throttle: each admin.graphql() response is run through
// throttleAfter() (shared shopify-throttle helper). Same buffer-200
// behavior as the worker phases — the leaky bucket fills back to 200
// before the next page request fires.

import prisma from "../app/db.server";
import { unauthenticated } from "../app/shopify.server";
import {
  CUSTOMERS_PAGE_QUERY,
  CUSTOMER_ORDERS_QUERY,
  customerEmail,
  customerPhone,
  customerRegion,
  type CustomersPageResponse,
  type CustomerOrdersResponse,
  type GqlCustomer,
  type GqlOrder,
} from "../app/lib/catalog/queries/customers.server";
import {
  throttleAfter,
  type ShopifyGqlResponse,
} from "../app/lib/catalog/shopify-throttle.server";
import { upsertCustomerProfile } from "../app/lib/customers/upsert.server";
import {
  buildOrderContext,
  orderEventExists,
} from "../app/lib/customers/order-events.server";
import { shouldEmitShortVisibilityWarn } from "../app/lib/customers/short-visibility-warn.server";

const WINDOW_DAYS = 90;
const NINETY_DAYS_MS = WINDOW_DAYS * 24 * 60 * 60 * 1000;
const SHOPIFY_DOMAIN_RE = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i;

type AdminClient = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<{ json: () => Promise<unknown> }>;
};

type Logger = (event: string, data: Record<string, unknown>) => void;

const log: Logger = (event, data) => {
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ event, ...data }));
};

const warn: Logger = (event, data) => {
  // eslint-disable-next-line no-console
  console.warn(JSON.stringify({ event, level: "warn", ...data }));
};

function ninetyDaysAgoISODate(): string {
  const d = new Date(Date.now() - NINETY_DAYS_MS);
  return d.toISOString().slice(0, 10);
}

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

async function fetchCustomersPage(
  admin: AdminClient,
  cursor: string | null,
): Promise<CustomersPageResponse["customers"]> {
  const response = await admin.graphql(CUSTOMERS_PAGE_QUERY, {
    variables: { cursor },
  });
  const payload = (await response.json()) as ShopifyGqlResponse<CustomersPageResponse>;
  if (payload.errors?.length) {
    throw new Error(
      `customers GraphQL errors: ${JSON.stringify(payload.errors)}`,
    );
  }
  if (!payload.data?.customers) {
    throw new Error(
      `customers GraphQL returned no data: ${JSON.stringify(payload).slice(0, 500)}`,
    );
  }
  await throttleAfter(payload);
  return payload.data.customers;
}

async function fetchCustomerOrdersPage(
  admin: AdminClient,
  customerGid: string,
  cursor: string | null,
  query: string,
): Promise<{ orders: GqlOrder[]; hasNextPage: boolean; endCursor: string | null }> {
  const response = await admin.graphql(CUSTOMER_ORDERS_QUERY, {
    variables: { id: customerGid, cursor, query },
  });
  const payload = (await response.json()) as ShopifyGqlResponse<CustomerOrdersResponse>;
  if (payload.errors?.length) {
    throw new Error(
      `customer.orders GraphQL errors for ${customerGid}: ${JSON.stringify(payload.errors)}`,
    );
  }
  await throttleAfter(payload);
  const orders = payload.data?.customer?.orders;
  if (!orders) {
    return { orders: [], hasNextPage: false, endCursor: null };
  }
  return {
    orders: orders.nodes,
    hasNextPage: orders.pageInfo.hasNextPage,
    endCursor: orders.pageInfo.endCursor,
  };
}

type OrderBackfillStats = {
  ordersFetched: number;
  eventsInserted: number;
  eventsSkipped: number;
  minOrderCreatedAt: Date | null;
};

async function backfillOrdersForCustomer(
  admin: AdminClient,
  shopDomain: string,
  profileId: string,
  customer: GqlCustomer,
  orderQueryFilter: string,
): Promise<OrderBackfillStats> {
  let cursor: string | null = null;
  let hasNextPage = true;
  let ordersFetched = 0;
  let eventsInserted = 0;
  let eventsSkipped = 0;
  let minOrderCreatedAt: Date | null = null;

  while (hasNextPage) {
    const page = await fetchCustomerOrdersPage(
      admin,
      customer.id,
      cursor,
      orderQueryFilter,
    );
    for (const order of page.orders) {
      ordersFetched += 1;
      const orderCreatedAt = new Date(order.createdAt);
      if (
        !Number.isNaN(orderCreatedAt.getTime()) &&
        (minOrderCreatedAt === null ||
          orderCreatedAt.getTime() < minOrderCreatedAt.getTime())
      ) {
        minOrderCreatedAt = orderCreatedAt;
      }
      const exists = await orderEventExists(profileId, order.id);
      if (exists) {
        eventsSkipped += 1;
        continue;
      }
      await prisma.customerEvent.create({
        data: {
          shopDomain,
          profileId,
          sessionId: null,
          kind: "ORDER_PLACED",
          context: buildOrderContext(order),
          occurredAt: orderCreatedAt,
        },
        select: { id: true },
      });
      eventsInserted += 1;
    }
    hasNextPage = page.hasNextPage;
    cursor = page.endCursor;
  }

  return { ordersFetched, eventsInserted, eventsSkipped, minOrderCreatedAt };
}

async function main(): Promise<void> {
  // eslint-disable-next-line no-undef
  const shopDomain = process.argv[2]?.trim();
  if (!shopDomain) {
    // eslint-disable-next-line no-console
    console.error("usage: npx tsx scripts/backfill-customers.ts <shopDomain>");
    // eslint-disable-next-line no-undef
    process.exit(2);
  }
  if (!SHOPIFY_DOMAIN_RE.test(shopDomain)) {
    // eslint-disable-next-line no-console
    console.error(
      `invalid shopDomain "${shopDomain}" — expected <handle>.myshopify.com`,
    );
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
      `[backfill-customers] MerchantConfig not found for shop "${shopDomain}". Refusing to run.`,
    );
    // eslint-disable-next-line no-undef
    process.exit(1);
  }

  const ninetyDaysAgoISODateStr = ninetyDaysAgoISODate();
  const orderQueryFilter = `created_at:>=${ninetyDaysAgoISODateStr}`;
  log("backfill_customers_started", {
    shopDomain,
    orderWindow: orderQueryFilter,
    windowDays: WINDOW_DAYS,
  });

  const { admin } = await unauthenticated.admin(shopDomain);

  let customerCursor: string | null = null;
  let hasNextPage = true;
  let customersProcessed = 0;
  let customersFailed = 0;
  let totalOrdersFetched = 0;
  let totalEventsInserted = 0;
  let totalEventsSkipped = 0;
  let minOrderCreatedAtSeen: Date | null = null;

  while (hasNextPage) {
    const page = await fetchCustomersPage(admin, customerCursor);
    for (const customer of page.nodes) {
      try {
        const upsertResult = await upsertCustomerProfile({
          shopDomain,
          shopifyCustomerId: customer.id,
          email: customerEmail(customer),
          phone: customerPhone(customer),
          firstName: customer.firstName,
          lastName: customer.lastName,
          locale: customer.locale,
          region: customerRegion(customer),
          shopifyCreatedAt: parseDate(customer.createdAt),
          shopifyUpdatedAt: parseDate(customer.updatedAt),
        });
        const orderStats = await backfillOrdersForCustomer(
          admin,
          shopDomain,
          upsertResult.id,
          customer,
          orderQueryFilter,
        );
        customersProcessed += 1;
        totalOrdersFetched += orderStats.ordersFetched;
        totalEventsInserted += orderStats.eventsInserted;
        totalEventsSkipped += orderStats.eventsSkipped;
        if (
          orderStats.minOrderCreatedAt &&
          (minOrderCreatedAtSeen === null ||
            orderStats.minOrderCreatedAt.getTime() <
              minOrderCreatedAtSeen.getTime())
        ) {
          minOrderCreatedAtSeen = orderStats.minOrderCreatedAt;
        }

        log("backfill_customer", {
          shopDomain,
          customerId: customer.id,
          profileId: upsertResult.id,
          created: upsertResult.created,
          ordersFetched: orderStats.ordersFetched,
          eventsInserted: orderStats.eventsInserted,
          eventsSkipped: orderStats.eventsSkipped,
        });
      } catch (err) {
        customersFailed += 1;
        // eslint-disable-next-line no-console
        console.error(
          JSON.stringify({
            event: "backfill_customer_failed",
            shopDomain,
            customerId: customer.id,
            message: err instanceof Error ? err.message : String(err),
          }),
        );
      }
    }
    hasNextPage = page.pageInfo.hasNextPage;
    customerCursor = page.pageInfo.endCursor;
  }

  // End-of-run heuristic: if we asked for a 90d order window but the
  // oldest order observed sits at the ~60d boundary, Shopify likely
  // clipped the result set due to missing read_all_orders scope. Soft
  // warn — one-shot — so the operator can correlate dev-shop
  // undercounts with scope rather than a backfill bug.
  const shouldWarn = shouldEmitShortVisibilityWarn({
    totalOrdersFetched,
    configuredWindowDays: WINDOW_DAYS,
    minOrderCreatedAtSeen,
    now: new Date(),
  });
  if (shouldWarn) {
    const oldestOrderAgeDays =
      minOrderCreatedAtSeen === null
        ? null
        : Math.round(
            (Date.now() - minOrderCreatedAtSeen.getTime()) /
              (24 * 60 * 60 * 1000),
          );
    warn("backfill_customers_short_visibility_window_clipped", {
      shopDomain,
      configuredWindowDays: WINDOW_DAYS,
      oldestOrderAgeDays,
      hint: "oldest order observed at ~60-day boundary; configured window was N days. Possible read_all_orders scope unavailable; orders older than 60 days may be silently absent.",
    });
  }

  log("backfill_customers_done", {
    shopDomain,
    customersProcessed,
    customersFailed,
    totalOrdersFetched,
    totalEventsInserted,
    totalEventsSkipped,
    minOrderCreatedAtSeen: minOrderCreatedAtSeen?.toISOString() ?? null,
  });
}

main()
  .then(async () => {
    await prisma.$disconnect();
    // eslint-disable-next-line no-undef
    process.exit(0);
  })
  .catch(async (err) => {
    // eslint-disable-next-line no-console
    console.error("[backfill-customers] fatal:", err);
    await prisma.$disconnect().catch(() => {});
    // eslint-disable-next-line no-undef
    process.exit(1);
  });
