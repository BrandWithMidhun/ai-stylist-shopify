// POST /api/products/:id/mark-reviewed
//
// 005d action: flips every existing ProductTag on the product to
// source="HUMAN" AND locked=true. The lock is essential — without it the
// next AI run would overwrite the human work, defeating the purpose of
// "Mark reviewed" (clarification B from the 005d execution plan).
//
// Idempotent: calling twice on an already-reviewed product is a no-op.
// Returns {ok:true, tagsUpdated} so the dashboard can revalidate stats.

import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const action = async ({ request, params }: ActionFunctionArgs) => {
  if (request.method !== "POST") {
    return Response.json(
      { ok: false, error: "method_not_allowed" },
      { status: 405 },
    );
  }

  const { session } = await authenticate.admin(request);
  const id = params.id;
  if (!id) {
    return Response.json(
      { ok: false, error: "missing_id" },
      { status: 400 },
    );
  }

  const product = await prisma.product.findFirst({
    where: { id, shopDomain: session.shop, deletedAt: null },
    select: { id: true },
  });
  if (!product) {
    return Response.json(
      { ok: false, error: "not_found" },
      { status: 404 },
    );
  }

  const actorId = extractActorId(session);

  const tagsUpdated = await prisma.$transaction(async (tx) => {
    const existing = await tx.productTag.findMany({
      where: { productId: product.id },
      select: { id: true, axis: true, value: true, source: true, locked: true },
    });

    if (existing.length === 0) return 0;

    const needsChange = existing.filter(
      (t) => t.source !== "HUMAN" || t.locked !== true,
    );
    if (needsChange.length === 0) return 0;

    await tx.productTag.updateMany({
      where: { id: { in: needsChange.map((t) => t.id) } },
      data: { source: "HUMAN", locked: true },
    });

    // Single summary audit row. ProductTagAudit has no metadata JSON column
    // in 005a, so we encode the original-source distribution per the 005c
    // audit-encoding pattern (see api.catalog.tags.reset.tsx:74-80):
    //   axis          -> "mark_reviewed"
    //   previousValue -> CSV of original sources (one per affected tag)
    //   newValue      -> updated tag count as string
    await tx.productTagAudit.create({
      data: {
        productId: product.id,
        shopDomain: session.shop,
        axis: "mark_reviewed",
        action: "MARK_REVIEWED",
        previousValue: needsChange.map((t) => t.source).join(","),
        newValue: String(needsChange.length),
        source: "HUMAN",
        actorId,
      },
    });

    return needsChange.length;
  });

  return Response.json({ ok: true, tagsUpdated });
};

function extractActorId(session: unknown): string | null {
  if (typeof session !== "object" || session === null) return null;
  const s = session as {
    onlineAccessInfo?: { associated_user?: { id?: unknown } };
  };
  const id = s.onlineAccessInfo?.associated_user?.id;
  if (typeof id === "number" || typeof id === "string") return String(id);
  return null;
}

export const loader = () =>
  Response.json({ error: "method_not_allowed" }, { status: 405 });
