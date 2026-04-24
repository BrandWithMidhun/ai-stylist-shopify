import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;

  const baseWhere = { shopDomain, deletedAt: null };

  const [totalProducts, byStatus, byInventory, config] = await Promise.all([
    prisma.product.count({ where: baseWhere }),
    prisma.product.groupBy({
      by: ["status"],
      where: baseWhere,
      _count: { _all: true },
    }),
    prisma.product.groupBy({
      by: ["inventoryStatus"],
      where: baseWhere,
      _count: { _all: true },
    }),
    prisma.merchantConfig.findUnique({
      where: { shop: shopDomain },
      select: { lastFullSyncAt: true },
    }),
  ]);

  const [humanCount, ruleCount, aiCount] = await Promise.all([
    prisma.product.count({
      where: {
        ...baseWhere,
        tags: { some: { source: "HUMAN" } },
      },
    }),
    prisma.product.count({
      where: {
        ...baseWhere,
        tags: { some: { source: "RULE" }, none: { source: "HUMAN" } },
      },
    }),
    prisma.product.count({
      where: {
        ...baseWhere,
        tags: {
          some: { source: "AI" },
          none: { source: { in: ["HUMAN", "RULE"] } },
        },
      },
    }),
  ]);

  const untagged = Math.max(totalProducts - humanCount - ruleCount - aiCount, 0);

  return Response.json({
    totalProducts,
    byStatus: toRecord(byStatus, "status"),
    byInventory: toRecord(byInventory, "inventoryStatus"),
    byTagSource: {
      untagged,
      ai: aiCount,
      rule: ruleCount,
      human: humanCount,
    },
    lastFullSyncAt: config?.lastFullSyncAt?.toISOString() ?? null,
  });
};

function toRecord<K extends string>(
  rows: Array<{ _count: { _all: number } } & Record<K, string>>,
  key: K,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of rows) {
    out[row[key]] = row._count._all;
  }
  return out;
}
