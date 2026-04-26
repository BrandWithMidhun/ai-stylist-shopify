// Reset tagging rules to the storeMode defaults (006a follow-up).
//
// Mirror of the taxonomy reset endpoint: seedRules bails when any
// TaggingRule rows exist, so a storeMode switch leaves merchants
// stranded on the old vertical's rules. Wiping rules first lets the
// guard pass and the fresh defaults seed in the same transaction.
//
// We do NOT touch ProductTag rows — existing tags on products stay put
// (rules only ever wrote to empty axes anyway, so the historical effect
// of those rules is captured in the tags themselves).

import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { seedRules } from "../lib/catalog/rule-seeds";
import type { StoreMode } from "../lib/catalog/store-axes";

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") {
    return Response.json({ error: "method_not_allowed" }, { status: 405 });
  }
  const { session } = await authenticate.admin(request);

  const config = await prisma.merchantConfig.findUnique({
    where: { shop: session.shop },
    select: { storeMode: true },
  });
  const storeMode: StoreMode =
    ((config?.storeMode ?? null) as StoreMode | null) ?? "GENERAL";

  const result = await prisma.$transaction(async (tx) => {
    await tx.taggingRule.deleteMany({
      where: { shopDomain: session.shop },
    });
    const seed = await seedRules(session.shop, storeMode, tx);
    return seed.created;
  });

  return Response.json({ ok: true, rulesCreated: result, storeMode });
};

export const loader = () => {
  return Response.json({ error: "method_not_allowed" }, { status: 405 });
};
