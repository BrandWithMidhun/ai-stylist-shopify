// PR-D D.3: Admin GraphQL queries for the customer + 90-day order
// backfill (scripts/backfill-customers.ts) and the post-run verifier.
//
// Why a new file rather than extending knowledge.server.ts: the
// knowledge queries serve the catalog ingest path (products/
// collections/metaobjects). Customer-side queries pull a different
// domain (CustomerProfile + CustomerEvent). Keeping them in their own
// module keeps the per-domain cost trade-offs and field shapes
// independent.
//
// Pagination defaults: 50 per page on customers + customer.orders
// (matches knowledge.server.ts; cursor-paginated; cost-bounded).
//
// Field-shape notes:
//   - defaultEmailAddress { emailAddress } and defaultPhoneNumber
//     { phoneNumber } are the post-deprecation accessors. The flat
//     email/phone fields on Customer have been deprecated on 2025-10
//     and will be removed in a future API version; we use the new
//     shape directly.
//   - defaultAddress is nullable. We pull country (display name) for
//     the CustomerProfile.region column; countryCodeV2 (ISO-2) is
//     also fetched for downstream use if needed.
//   - customer.orders accepts Shopify's order search syntax via the
//     query: arg. The 90d filter is built by the script as
//     `created_at:>=YYYY-MM-DD` and passed in via $query so the
//     query string itself remains a parameterized variable.
//
// customersCount / ordersCount: Shopify exposes these on the Shop
// query root (NOT on Shop type). Both return a Count type with
// { count: Int!, precision: CountPrecision! }. precision values:
//   EXACT                — count is exact.
//   AT_LEAST             — at least N (the limit was hit).
//   AT_LEAST_APPROXIMATE — at least approximately N.
// limit: null asks Shopify for the highest-precision count it can
// give without a hard cap. The verifier reads precision and routes to
// either an exact-equality assert or a 5%-tolerance band.
//
// scope requirements (validated via shopify-dev MCP against 2025-10):
//   CUSTOMERS_PAGE_QUERY, CUSTOMERS_COUNT_QUERY: read_customers
//   CUSTOMER_ORDERS_QUERY: read_customers + read_orders
//   ORDERS_COUNT_QUERY: read_orders
// read_all_orders is required to see orders older than 60 days; if
// unavailable, customer.orders silently returns only the 60-day
// window. The backfill script logs a one-time warning on suspected
// undercount; see backfill-customers.ts for the detection.

export const CUSTOMERS_PAGE_QUERY = `#graphql
  query CustomersPage($cursor: String) {
    customers(first: 50, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        firstName
        lastName
        locale
        createdAt
        updatedAt
        defaultEmailAddress { emailAddress }
        defaultPhoneNumber { phoneNumber }
        defaultAddress { country countryCodeV2 }
      }
    }
  }
`;

export const CUSTOMER_ORDERS_QUERY = `#graphql
  query CustomerOrders($id: ID!, $cursor: String, $query: String) {
    customer(id: $id) {
      id
      orders(first: 50, after: $cursor, query: $query) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id
          createdAt
          totalPriceSet { shopMoney { amount currencyCode } }
          lineItems(first: 20) {
            edges {
              node {
                quantity
                title
                originalUnitPriceSet { shopMoney { amount currencyCode } }
                product { id }
              }
            }
          }
        }
      }
    }
  }
`;

export const CUSTOMERS_COUNT_QUERY = `#graphql
  query CustomersCount {
    customersCount(limit: null) {
      count
      precision
    }
  }
`;

export const ORDERS_COUNT_QUERY = `#graphql
  query OrdersCount($query: String) {
    ordersCount(query: $query, limit: null) {
      count
      precision
    }
  }
`;

// --- Result types ---------------------------------------------------------

export type GqlMoney = {
  amount: string;
  currencyCode: string;
};

export type GqlCustomer = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  locale: string | null;
  createdAt: string;
  updatedAt: string;
  defaultEmailAddress: { emailAddress: string | null } | null;
  defaultPhoneNumber: { phoneNumber: string | null } | null;
  defaultAddress: {
    country: string | null;
    countryCodeV2: string | null;
  } | null;
};

export type GqlOrderLineItem = {
  quantity: number;
  title: string;
  originalUnitPriceSet: { shopMoney: GqlMoney };
  product: { id: string } | null;
};

export type GqlOrder = {
  id: string;
  createdAt: string;
  totalPriceSet: { shopMoney: GqlMoney };
  lineItems: {
    edges: Array<{ node: GqlOrderLineItem }>;
  };
};

export type CustomersPageResponse = {
  customers: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    nodes: GqlCustomer[];
  };
};

export type CustomerOrdersResponse = {
  customer: {
    id: string;
    orders: {
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
      nodes: GqlOrder[];
    };
  } | null;
};

// CountPrecision values per Shopify Admin schema. AT_LEAST signals
// the result was capped by the implicit limit (Shopify defaults to
// 10000 when `limit: null` is passed and the actual count exceeds
// that ceiling); AT_LEAST_APPROXIMATE is an estimator response on
// large catalogs. Verifier treats both as tolerance-band cases.
export type CountPrecision = "EXACT" | "AT_LEAST" | "AT_LEAST_APPROXIMATE";

export type GqlCount = {
  count: number;
  precision: CountPrecision;
};

export type CustomersCountResponse = {
  customersCount: GqlCount;
};

export type OrdersCountResponse = {
  ordersCount: GqlCount;
};

// --- Convenience accessors -----------------------------------------------
//
// Each accessor unwraps the nested-nullable shape to a flat string |
// null. The post-deprecation defaultEmailAddress / defaultPhoneNumber
// objects can be null (no address on file), and the inner
// emailAddress / phoneNumber strings can also be null. Callers want
// "the email if any" semantics — these collapse the two-level
// nullable to a single null.

export function customerEmail(c: GqlCustomer): string | null {
  return c.defaultEmailAddress?.emailAddress ?? null;
}

export function customerPhone(c: GqlCustomer): string | null {
  return c.defaultPhoneNumber?.phoneNumber ?? null;
}

export function customerRegion(c: GqlCustomer): string | null {
  return c.defaultAddress?.country ?? null;
}
