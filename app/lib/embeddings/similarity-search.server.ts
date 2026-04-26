// Pgvector-backed semantic retrieval. Pure: no LLM calls, no card
// formatting — callers feed in a 1024-dim query vector and receive the
// top-N candidate rows ordered by cosine distance ascending.
//
// Why raw SQL: Product.embedding is `Unsupported("vector(1024)")?` in the
// Prisma schema. The query builder can neither read nor compare the
// column, so the similarity step has to live in $queryRaw. We then do a
// second, typed Prisma query to load the variant + tag relations for the
// returned IDs — that side is type-safe and reuses the relation-loading
// patterns already established in search-products.server.ts.
//
// Cosine distance (`<=>`): pgvector returns a value in [0, 2] — 0 means
// identical direction, 1 is orthogonal, 2 is opposite. For voyage-3
// embeddings of products vs intent strings, real-world good matches sit
// around 0.2–0.5, mediocre around 0.6–0.9, and >1.0 effectively means
// "no semantically relevant catalog match." We log the top distance from
// recommend_products so we can watch quality in Railway.
//
// Why pre-filter ACTIVE / available / not-excluded inside the SQL: doing
// it post-hoc in JS would waste retrieval slots on products that can't be
// rendered (out of stock, soft-deleted, merchant-excluded). Pre-filtering
// means each of the 30 candidate slots is a real, buyable product.

import { Prisma } from "@prisma/client";
import prisma from "../../db.server";

export type SimilarProductRow = {
  id: string;
  handle: string;
  title: string;
  productType: string | null;
  vendor: string | null;
  featuredImageUrl: string | null;
  priceMin: Prisma.Decimal | null;
  priceMax: Prisma.Decimal | null;
  currency: string | null;
  variants: Array<{
    shopifyId: string;
    price: Prisma.Decimal;
    compareAtPrice: Prisma.Decimal | null;
    availableForSale: boolean;
  }>;
  tags: Array<{ axis: string; value: string }>;
  distance: number;
};

const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 50;

type RawRow = {
  id: string;
  handle: string;
  title: string;
  productType: string | null;
  vendor: string | null;
  featuredImageUrl: string | null;
  priceMin: Prisma.Decimal | null;
  priceMax: Prisma.Decimal | null;
  currency: string | null;
  distance: number;
};

export async function findSimilarProducts(args: {
  shopDomain: string;
  queryVector: number[];
  limit?: number;
  priceMin?: number;
  priceMax?: number;
}): Promise<SimilarProductRow[]> {
  const limit = Math.min(
    Math.max(1, Math.floor(args.limit ?? DEFAULT_LIMIT)),
    MAX_LIMIT,
  );

  // Same `[v1,v2,...]` literal shape embed-products.server.ts writes on
  // the index path. Postgres parses it into a `vector` value via the
  // ::vector cast.
  const vectorLiteral = `[${args.queryVector.join(",")}]`;

  // Overlapping-range price semantics matching search-products.server.ts:
  // a product matches if any variant could plausibly fall in the range.
  const minClause =
    args.priceMin != null
      ? Prisma.sql`AND p."priceMax" >= ${args.priceMin}`
      : Prisma.empty;
  const maxClause =
    args.priceMax != null
      ? Prisma.sql`AND p."priceMin" <= ${args.priceMax}`
      : Prisma.empty;

  const rows = await prisma.$queryRaw<RawRow[]>(Prisma.sql`
    SELECT
      p.id,
      p.handle,
      p.title,
      p."productType" AS "productType",
      p.vendor,
      p."featuredImageUrl" AS "featuredImageUrl",
      p."priceMin" AS "priceMin",
      p."priceMax" AS "priceMax",
      p.currency,
      p."embedding" <=> ${vectorLiteral}::vector AS distance
    FROM "Product" p
    WHERE p."shopDomain" = ${args.shopDomain}
      AND p.status = 'ACTIVE'
      AND p."deletedAt" IS NULL
      AND p."recommendationExcluded" = false
      AND p."embedding" IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM "ProductVariant" v
        WHERE v."productId" = p.id AND v."availableForSale" = true
      )
      ${minClause}
      ${maxClause}
    ORDER BY p."embedding" <=> ${vectorLiteral}::vector
    LIMIT ${limit}
  `);

  if (rows.length === 0) return [];

  // Second pass: typed Prisma query for the relation data. The vector
  // similarity SQL stays narrow; this side gets type-safe variant +
  // tag loading with the same shape search_products uses.
  const ids = rows.map((r) => r.id);
  const enriched = await prisma.product.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      variants: {
        take: 1,
        orderBy: { price: "asc" },
        select: {
          shopifyId: true,
          price: true,
          compareAtPrice: true,
          availableForSale: true,
        },
      },
      tags: { select: { axis: true, value: true } },
    },
  });

  const byId = new Map(enriched.map((e) => [e.id, e]));

  // Preserve the raw query's distance-ascending order — Map lookups
  // hand back the relation data, but the raw rows drive the final
  // ordering callers depend on.
  return rows.map((r) => {
    const e = byId.get(r.id);
    return {
      id: r.id,
      handle: r.handle,
      title: r.title,
      productType: r.productType,
      vendor: r.vendor,
      featuredImageUrl: r.featuredImageUrl,
      priceMin: r.priceMin,
      priceMax: r.priceMax,
      currency: r.currency,
      variants: e?.variants ?? [],
      tags: e?.tags ?? [],
      distance: Number(r.distance),
    };
  });
}
