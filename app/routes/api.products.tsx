import type { LoaderFunctionArgs } from "react-router";
import type { Prisma } from "@prisma/client";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { computeTagStatus } from "../lib/catalog/tag-status";

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 50;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);

  const status = url.searchParams.get("status");
  const inventory = url.searchParams.get("inventory");
  const cursor = url.searchParams.get("cursor");
  const limitRaw = Number(url.searchParams.get("limit") ?? DEFAULT_LIMIT);
  const limit = Number.isFinite(limitRaw)
    ? Math.min(Math.max(Math.trunc(limitRaw), 1), MAX_LIMIT)
    : DEFAULT_LIMIT;

  const where: Prisma.ProductWhereInput = {
    shopDomain: session.shop,
    deletedAt: null,
  };
  if (status) where.status = status;
  if (inventory) where.inventoryStatus = inventory;

  const products = await prisma.product.findMany({
    where,
    include: { tags: true },
    orderBy: { shopifyUpdatedAt: "desc" },
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });

  const hasMore = products.length > limit;
  const page = hasMore ? products.slice(0, limit) : products;
  const nextCursor = hasMore ? page[page.length - 1].id : null;

  return Response.json({
    products: page.map((p) => ({
      id: p.id,
      shopifyId: p.shopifyId,
      title: p.title,
      handle: p.handle,
      status: p.status,
      inventoryStatus: p.inventoryStatus,
      featuredImageUrl: p.featuredImageUrl,
      priceMin: p.priceMin?.toString() ?? null,
      priceMax: p.priceMax?.toString() ?? null,
      currency: p.currency,
      totalInventory: p.totalInventory,
      tags: p.tags.map((t) => ({
        axis: t.axis,
        value: t.value,
        source: t.source,
        locked: t.locked,
        confidence: t.confidence,
      })),
      tagStatus: computeTagStatus(p.tags.map((t) => t.source)),
    })),
    nextCursor,
  });
};
