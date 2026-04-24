// PATCH /api/products/:id/exclude
//
// Toggles product.recommendationExcluded. No audit row — this flag does
// not affect tags and is cheap to flip back. The route validates the
// product belongs to the authenticated shop via updateMany with a shop
// scope filter; a count of 0 means not found (404).

import type { ActionFunctionArgs } from "react-router";
import { z } from "zod";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

const BodySchema = z.object({ excluded: z.boolean() });

export const action = async ({ request, params }: ActionFunctionArgs) => {
  if (request.method !== "PATCH") {
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

  const raw = (await request.json()) as unknown;
  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json(
      { ok: false, error: parsed.error.message },
      { status: 400 },
    );
  }

  const result = await prisma.product.updateMany({
    where: { id, shopDomain: session.shop, deletedAt: null },
    data: { recommendationExcluded: parsed.data.excluded },
  });

  if (result.count === 0) {
    return Response.json(
      { ok: false, error: "not_found" },
      { status: 404 },
    );
  }

  return Response.json({ ok: true, excluded: parsed.data.excluded });
};

export const loader = () =>
  Response.json({ error: "method_not_allowed" }, { status: 405 });
