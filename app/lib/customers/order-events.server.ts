// PR-D D.3: order-event helpers for the customer backfill.
//
// Why a shared module: the backfill script's idempotency guard
// (orderEventExists) and JSONB context builder (buildOrderContext)
// are unit-tested independently of the script's CLI/IO layer. Pulling
// them out keeps the script thin and the testable surface
// pure-function-ish (Prisma is the only external dep, and it's
// injected so tests mock it cleanly).

import type { Prisma, PrismaClient } from "@prisma/client";
import basePrisma from "../../db.server";
import {
  type GqlOrder,
} from "../catalog/queries/customers.server";
import { parsePriceToInt } from "./price.server";

type PrismaLike = PrismaClient | Prisma.TransactionClient;

// Existence check on (profileId, kind=ORDER_PLACED, orderGid). Uses
// JSONB containment (@>) so the existing
// CustomerEvent_shopDomain_kind_occurredAt index combined with the
// profileId equality narrows the scan; per-profile event counts
// over a 90d window are bounded enough that adding a partial unique
// index is overkill (Fork #2 default — application-level dedup).
export async function orderEventExists(
  profileId: string,
  orderGid: string,
  prismaClient: PrismaLike = basePrisma,
): Promise<boolean> {
  const rows = await prismaClient.$queryRaw<Array<{ exists: boolean }>>`
    SELECT EXISTS (
      SELECT 1 FROM "CustomerEvent"
      WHERE "profileId" = ${profileId}
        AND "kind" = 'ORDER_PLACED'::"CustomerEventKind"
        AND "context" @> ${`{"orderGid":"${orderGid}"}`}::jsonb
    ) AS "exists"
  `;
  return rows[0]?.exists === true;
}

// Build the JSONB payload for a CustomerEvent row from a Shopify
// order node. Schema:
//   {
//     orderGid: string,
//     totalCents: int,            // minor units (currency-aware)
//     currency: string,
//     items: [{ productGid, title, quantity, unitPriceCents }]
//   }
// scrubEventContext (PR-D D.1) preserves these keys on GDPR redact.
export function buildOrderContext(order: GqlOrder): Prisma.InputJsonValue {
  const totalAmount = order.totalPriceSet.shopMoney.amount;
  const totalCurrency = order.totalPriceSet.shopMoney.currencyCode;
  return {
    orderGid: order.id,
    totalCents: parsePriceToInt(totalAmount, totalCurrency),
    currency: totalCurrency,
    items: order.lineItems.edges.map((edge) => {
      const li = edge.node;
      return {
        productGid: li.product?.id ?? null,
        title: li.title,
        quantity: li.quantity,
        unitPriceCents: parsePriceToInt(
          li.originalUnitPriceSet.shopMoney.amount,
          li.originalUnitPriceSet.shopMoney.currencyCode,
        ),
      };
    }),
  };
}
