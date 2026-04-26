// Reset the taxonomy tree to the storeMode defaults (006a follow-up).
//
// The seed helper bails when any TaxonomyNode rows already exist (its
// idempotency guard), so a merchant who switches storeMode after the
// initial seed has no way to pull in the new defaults. This endpoint
// wipes the existing tree first, then re-seeds in the same transaction
// so the guard sees an empty table and proceeds.
//
// Product.taxonomyNodeId has onDelete: SetNull on the FK, so deleting
// the nodes already nulls product references — we still issue an
// explicit updateMany inside the transaction so the contract is obvious
// from the call site.

import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { seedTaxonomy } from "../lib/catalog/taxonomy-seeds";
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
    await tx.taxonomyNode.deleteMany({
      where: { shopDomain: session.shop },
    });
    await tx.product.updateMany({
      where: { shopDomain: session.shop },
      data: { taxonomyNodeId: null },
    });
    const seed = await seedTaxonomy(session.shop, storeMode, tx);
    return seed.created;
  });

  return Response.json({ ok: true, nodesCreated: result, storeMode });
};

export const loader = () => {
  return Response.json({ error: "method_not_allowed" }, { status: 405 });
};
