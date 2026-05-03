// PR-2.1: POST /api/intelligence/retag/:productId
//
// Merchant-triggered retag of a single product. The 2.3 admin UI's
// "Retag" button posts here. PR-2.1 ships the endpoint; PR-2.3 wires
// the button.
//
// Returns { jobId, deduped, status } — the caller can use jobId to
// poll TaggingJob status if it wants live progress (a future
// per-job-status endpoint would surface that).

import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { enqueueTaggingForProduct } from "../lib/catalog/enqueue-tagging.server";

export const action = async ({ request, params }: ActionFunctionArgs) => {
  if (request.method !== "POST") {
    return Response.json(
      { ok: false, error: "method_not_allowed" },
      { status: 405 },
    );
  }

  const { session } = await authenticate.admin(request);
  const productId = params.productId;
  if (!productId) {
    return Response.json(
      { ok: false, error: "missing_product_id" },
      { status: 400 },
    );
  }

  const product = await prisma.product.findFirst({
    where: { id: productId, shopDomain: session.shop, deletedAt: null },
    select: { id: true },
  });
  if (!product) {
    return Response.json(
      { ok: false, error: "product_not_found" },
      { status: 404 },
    );
  }

  const result = await enqueueTaggingForProduct({
    shopDomain: session.shop,
    productId: product.id,
    triggerSource: "MANUAL",
    kind: "MANUAL_RETAG",
  });

  return Response.json({
    ok: true,
    jobId: result.jobId,
    deduped: result.deduped,
    status: "QUEUED",
  });
};

export const loader = () =>
  Response.json({ error: "method_not_allowed" }, { status: 405 });
