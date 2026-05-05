// PR-3.1-mech.2: Stage 1 of the v2 recommendation pipeline — hard filters.
//
// Single SQL roundtrip via prisma.$queryRawUnsafe: narrows the shop's
// catalog to a candidate set that any later stage can rank, re-rank,
// or diversify against. No relation loads happen here — Stage 6 loads
// variants/tags only on the final top-N.
//
// Filters applied (every call):
//   - shopDomain match
//   - status = 'ACTIVE'
//   - deletedAt IS NULL
//   - recommendationExcluded = false      (Stage 4 reads recommendationPromoted)
//   - embedding IS NOT NULL                (Stage 2 needs the vector)
//   - EXISTS at least one variant with availableForSale = true
//
// Filters appended conditionally:
//   - priceMin / priceMax overlapping range (when set on PipelineInput)
//   - per-axis APPROVED-tag predicate for every axis in
//     HARD_FILTER_AXES[mode] that has non-empty values in QueryAttributes
//
// LIMIT 1000 is a defensive bound. Real-world dev shop returns <500
// pre-Stage-2; the cap prevents pathological queries on a 50K-product
// future merchant where Stage 1 could degenerate into a scan.
//
// APPROVED-only ProductTag filter: PENDING_REVIEW and REJECTED tags are
// merchant-undecided / merchant-rejected, so Stage 1 must not act on
// them. Same posture as rule-engine.server.ts (rules write APPROVED;
// AI writes PENDING_REVIEW; merchant reviews to APPROVED/REJECTED).
//
// Why $queryRawUnsafe instead of Prisma.sql tagged-template: the
// per-axis predicate count is dynamic (0..N axes contribute), and
// composing variable-length parameter positions through Prisma.sql
// requires nested Prisma.empty / Prisma.join glue that obscures the
// SQL more than the unsafe path. Param values are fully positional
// and originate from typed inputs (axis names from a code-locked
// constant, values from QueryAttributes string arrays); no untrusted
// data ever lands in the SQL string.

import type { Prisma } from "@prisma/client";
import prisma from "../../../db.server";
import {
  hardFilterAxesFor,
  type StoreMode,
} from "../../catalog/store-axes";
import type {
  CandidateProduct,
  PipelineInput,
  QueryAttributes,
  StageOutput,
} from "./types";

const STAGE_NAME = "stage-1-hard-filters";
const CANDIDATE_LIMIT = 1000;

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
  recommendationPromoted: boolean;
  recommendationExcluded: boolean;
};

export async function stage1HardFilters(
  input: PipelineInput,
  queryAttributes: QueryAttributes,
  mode: StoreMode,
): Promise<StageOutput> {
  const startMs = Date.now();

  // params[0] is shopDomain ($1). Subsequent params are pushed in
  // append order; each predicate that consumes a param records its
  // own positional index by reading params.length after pushing.
  const params: unknown[] = [input.shopDomain];
  const wherePredicates: string[] = [
    `p."shopDomain" = $1`,
    `p.status = 'ACTIVE'`,
    `p."deletedAt" IS NULL`,
    `p."recommendationExcluded" = false`,
    `p."embedding" IS NOT NULL`,
    `EXISTS (
      SELECT 1 FROM "ProductVariant" v
      WHERE v."productId" = p.id AND v."availableForSale" = true
    )`,
  ];

  // Price range — overlapping range semantics matching the
  // search-products / similarity-search precedent. A product with
  // priceMin=100 priceMax=200 should match a query with
  // priceMin=150 priceMax=300 because some variant could plausibly
  // fall in [150, 200].
  if (input.priceMin !== undefined && input.priceMin !== null) {
    params.push(input.priceMin);
    wherePredicates.push(`p."priceMax" >= $${params.length}`);
  }
  if (input.priceMax !== undefined && input.priceMax !== null) {
    params.push(input.priceMax);
    wherePredicates.push(`p."priceMin" <= $${params.length}`);
  }

  // Hard-filter axis predicates. Each contributing axis adds two
  // params (axis name + values array) and one EXISTS clause against
  // ProductTag with status='APPROVED'.
  const hardAxes = hardFilterAxesFor(mode);
  const filtersApplied: Record<string, string[]> = {};
  let hardFilterAxesActive = 0;
  for (const axis of hardAxes) {
    const values = queryAttributes[axis];
    if (!values || values.length === 0) continue;
    params.push(axis);
    const axisIdx = params.length;
    params.push(values);
    const valuesIdx = params.length;
    wherePredicates.push(`EXISTS (
      SELECT 1 FROM "ProductTag" t
      WHERE t."productId" = p.id
        AND t.status = 'APPROVED'
        AND t.axis = $${axisIdx}
        AND t.value = ANY($${valuesIdx}::text[])
    )`);
    filtersApplied[axis] = [...values];
    hardFilterAxesActive += 1;
  }

  const sql = `SELECT p.id, p.handle, p.title, p."productType", p.vendor,
       p."featuredImageUrl", p."priceMin", p."priceMax", p.currency,
       p."recommendationPromoted", p."recommendationExcluded"
FROM "Product" p
WHERE ${wherePredicates.join("\n  AND ")}
LIMIT ${CANDIDATE_LIMIT}`;

  const rows = await prisma.$queryRawUnsafe<RawRow[]>(sql, ...params);

  const candidates: CandidateProduct[] = rows.map((r) => ({
    id: r.id,
    handle: r.handle,
    title: r.title,
    productType: r.productType,
    vendor: r.vendor,
    featuredImageUrl: r.featuredImageUrl,
    priceMin: r.priceMin != null ? Number(r.priceMin) : null,
    priceMax: r.priceMax != null ? Number(r.priceMax) : null,
    currency: r.currency,
    recommendationPromoted: r.recommendationPromoted,
    recommendationExcluded: r.recommendationExcluded,
  }));

  // candidatesIn / candidatesOut convention for Stage 1:
  // Stage 1 is the first stage — there is no "previous" set to
  // narrow from. We report candidatesIn=candidatesOut=rows.length.
  // The trace orchestrator (mech.6) is free to backfill an upstream
  // universe count via meta if the trace consumer needs it.
  const ms = Date.now() - startMs;
  const priceRange =
    input.priceMin !== undefined || input.priceMax !== undefined
      ? {
          min: input.priceMin ?? null,
          max: input.priceMax ?? null,
        }
      : null;

  return {
    candidates,
    contribution: {
      name: STAGE_NAME,
      ms,
      candidatesIn: rows.length,
      candidatesOut: candidates.length,
      meta: {
        filtersApplied,
        priceRange,
        hardFilterAxesActive,
      },
    },
  };
}
