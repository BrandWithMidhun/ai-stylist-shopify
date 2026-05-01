// PR-D D.3: order-event helpers — orderGid existence-check de-dup
// (mocked Prisma) + context-builder shape (mocked Shopify response).

import { describe, it, expect, vi } from "vitest";
import { buildOrderContext, orderEventExists } from "./order-events.server";
import type { GqlOrder } from "../catalog/queries/customers.server";

// Minimal stub shaped to PrismaClient | TransactionClient. Only
// $queryRaw is touched by orderEventExists; the type cast at call
// sites is intentional — we don't want to drag the full Prisma type
// graph into tests.
type StubPrisma = {
  $queryRaw: ReturnType<typeof vi.fn>;
};

function stubPrisma(returnValue: unknown): StubPrisma {
  return {
    $queryRaw: vi.fn().mockResolvedValue(returnValue),
  };
}

function makeOrder(overrides: Partial<GqlOrder> = {}): GqlOrder {
  return {
    id: "gid://shopify/Order/1234",
    createdAt: "2026-04-15T10:00:00Z",
    totalPriceSet: { shopMoney: { amount: "29.95", currencyCode: "USD" } },
    lineItems: {
      edges: [
        {
          node: {
            quantity: 2,
            title: "T-shirt",
            originalUnitPriceSet: {
              shopMoney: { amount: "14.95", currencyCode: "USD" },
            },
            product: { id: "gid://shopify/Product/9001" },
          },
        },
      ],
    },
    ...overrides,
  };
}

describe("orderEventExists", () => {
  it("returns true when prisma reports the row exists", async () => {
    const p = stubPrisma([{ exists: true }]);
    const result = await orderEventExists(
      "profile-1",
      "gid://shopify/Order/1234",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      p as any,
    );
    expect(result).toBe(true);
    expect(p.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it("returns false when prisma reports the row does not exist", async () => {
    const p = stubPrisma([{ exists: false }]);
    const result = await orderEventExists(
      "profile-1",
      "gid://shopify/Order/9999",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      p as any,
    );
    expect(result).toBe(false);
  });

  it("returns false when prisma returns an empty result set", async () => {
    // Defensive: SELECT EXISTS always returns one row in practice,
    // but the helper guards against the empty-array case.
    const p = stubPrisma([]);
    const result = await orderEventExists(
      "profile-1",
      "gid://shopify/Order/9999",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      p as any,
    );
    expect(result).toBe(false);
  });
});

describe("buildOrderContext", () => {
  it("emits the canonical ORDER_PLACED context shape", () => {
    const ctx = buildOrderContext(makeOrder()) as {
      orderGid: string;
      totalCents: number;
      currency: string;
      items: Array<{
        productGid: string | null;
        title: string;
        quantity: number;
        unitPriceCents: number;
      }>;
    };
    expect(ctx.orderGid).toBe("gid://shopify/Order/1234");
    expect(ctx.totalCents).toBe(2995);
    expect(ctx.currency).toBe("USD");
    expect(ctx.items).toHaveLength(1);
    expect(ctx.items[0]).toEqual({
      productGid: "gid://shopify/Product/9001",
      title: "T-shirt",
      quantity: 2,
      unitPriceCents: 1495,
    });
  });

  it("preserves a null productGid when the line item has no product", () => {
    const order = makeOrder({
      lineItems: {
        edges: [
          {
            node: {
              quantity: 1,
              title: "Custom item (deleted product)",
              originalUnitPriceSet: {
                shopMoney: { amount: "10.00", currencyCode: "USD" },
              },
              product: null,
            },
          },
        ],
      },
    });
    const ctx = buildOrderContext(order) as {
      items: Array<{ productGid: string | null }>;
    };
    expect(ctx.items[0].productGid).toBeNull();
  });

  it("uses zero-decimal cents for JPY orders", () => {
    const order = makeOrder({
      totalPriceSet: { shopMoney: { amount: "5000", currencyCode: "JPY" } },
      lineItems: {
        edges: [
          {
            node: {
              quantity: 1,
              title: "Item",
              originalUnitPriceSet: {
                shopMoney: { amount: "5000", currencyCode: "JPY" },
              },
              product: { id: "gid://shopify/Product/1" },
            },
          },
        ],
      },
    });
    const ctx = buildOrderContext(order) as {
      totalCents: number;
      currency: string;
      items: Array<{ unitPriceCents: number }>;
    };
    expect(ctx.totalCents).toBe(5000);
    expect(ctx.currency).toBe("JPY");
    expect(ctx.items[0].unitPriceCents).toBe(5000);
  });
});
