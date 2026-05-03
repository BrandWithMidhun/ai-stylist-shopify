// PR-2.1: POST /api/products/:id/tags/review
//
// Per-tag approve/reject endpoint. The 2.3 review UI POSTs here.
//
// Body shape:
//   { tagId: string, action: "APPROVE" | "REJECT" }
//
// Effects:
//   - APPROVE: ProductTag.status = APPROVED, reviewedAt = now,
//     reviewedBy = staff member GID. Audit row action="APPROVE".
//   - REJECT:  ProductTag.status = REJECTED, reviewedAt = now,
//     reviewedBy = staff member GID. Audit row action="REJECT".
//     The row is NOT deleted — it persists so the next AI retag can
//     pass it to the prompt as an exclusion (rejectedValuesByAxis).
//
// Distinct from the legacy api.products.$id.mark-reviewed route which
// flips ALL tags on a product to source=HUMAN, locked=true. That
// route remains untouched (per PR-2.1 plan Q5).
//
// Returns the updated ProductTag row as JSON.

import type { ActionFunctionArgs } from "react-router";
import { z } from "zod";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

const BodySchema = z.object({
  tagId: z.string().min(1),
  action: z.enum(["APPROVE", "REJECT"]),
});

export const action = async ({ request, params }: ActionFunctionArgs) => {
  if (request.method !== "POST") {
    return Response.json(
      { ok: false, error: "method_not_allowed" },
      { status: 405 },
    );
  }

  const { session } = await authenticate.admin(request);
  const productIdParam = params.id;
  if (!productIdParam) {
    return Response.json(
      { ok: false, error: "missing_product_id" },
      { status: 400 },
    );
  }

  let body: z.infer<typeof BodySchema>;
  try {
    const raw = (await request.json()) as unknown;
    body = BodySchema.parse(raw);
  } catch (err) {
    return Response.json(
      {
        ok: false,
        error: "invalid_body",
        message: err instanceof Error ? err.message : String(err),
      },
      { status: 400 },
    );
  }

  const product = await prisma.product.findFirst({
    where: { id: productIdParam, shopDomain: session.shop, deletedAt: null },
    select: { id: true },
  });
  if (!product) {
    return Response.json(
      { ok: false, error: "product_not_found" },
      { status: 404 },
    );
  }

  const tag = await prisma.productTag.findFirst({
    where: { id: body.tagId, productId: product.id },
    select: {
      id: true,
      productId: true,
      shopDomain: true,
      axis: true,
      value: true,
      source: true,
      status: true,
    },
  });
  if (!tag) {
    return Response.json(
      { ok: false, error: "tag_not_found" },
      { status: 404 },
    );
  }

  const reviewerGid = staffMemberGid(session);
  const newStatus = body.action === "APPROVE" ? "APPROVED" : "REJECTED";
  const auditAction = body.action;

  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.productTag.update({
      where: { id: tag.id },
      data: {
        status: newStatus,
        reviewedAt: new Date(),
        reviewedBy: reviewerGid,
      },
    });
    await tx.productTagAudit.create({
      data: {
        productId: product.id,
        shopDomain: session.shop,
        axis: tag.axis,
        action: auditAction,
        previousValue: tag.status,
        newValue: newStatus,
        // The audit source carries the ORIGINAL source of the tag,
        // not "HUMAN", so the audit log preserves who generated it
        // (AI/RULE) alongside who reviewed it (actorId).
        source: tag.source,
        actorId: reviewerGid,
      },
    });
    return row;
  });

  return Response.json({ ok: true, tag: updated });
};

// Pull the Shopify staff member GID from the authenticated session.
// Online-access sessions carry onlineAccessInfo.associated_user.id;
// offline sessions don't, in which case we return null and the caller
// stores null reviewedBy (the column is nullable).
function staffMemberGid(session: unknown): string | null {
  if (typeof session !== "object" || session === null) return null;
  const s = session as {
    onlineAccessInfo?: { associated_user?: { id?: unknown } };
  };
  const id = s.onlineAccessInfo?.associated_user?.id;
  if (typeof id === "number" || typeof id === "string") {
    return `gid://shopify/StaffMember/${String(id)}`;
  }
  return null;
}

export const loader = () =>
  Response.json({ error: "method_not_allowed" }, { status: 405 });
