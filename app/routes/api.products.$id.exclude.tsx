// PATCH /api/products/:id/exclude
//
// Toggles product.recommendationExcluded. No audit row — this flag does
// not affect tags and is cheap to flip back. The route validates the
// product belongs to the authenticated shop via updateMany with a shop
// scope filter; a count of 0 means not found (404).
//
// PR-3.1.6-mech.3: on a (true → false) un-exclude transition, fire
// `triggerReembedOnUnexclude` to enqueue a RE_EMBED job. The product
// just became eligible for v2 retrieval again; without this trigger, the
// bulk script and NULL-hash scanner both filter it out (they require
// recommendationExcluded=false), so a stale embedding would persist
// indefinitely. Enqueue errors are isolated — the recommendation flag
// has already been toggled, and the embedding refresh is best-effort.

import type { ActionFunctionArgs } from "react-router";
import { z } from "zod";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { triggerReembedOnUnexclude } from "../lib/catalog/enqueue-reembed.server";

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

  // PR-3.1.6-mech.3: capture prior state so we can detect the
  // un-exclude transition. The prior read is scoped to the same
  // (id, shopDomain, deletedAt) filter the updateMany applies, so a
  // mid-flight delete-or-not-found case naturally produces null and
  // skips the trigger.
  const prior = await prisma.product.findFirst({
    where: { id, shopDomain: session.shop, deletedAt: null },
    select: { id: true, recommendationExcluded: true },
  });

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

  // PR-3.1.6-mech.3: best-effort RE_EMBED enqueue on un-exclude
  // transition. Fire-and-forget against the route response. The trigger
  // function itself only fires on (prior=true AND incoming=false); all
  // other transitions are no-ops.
  if (prior !== null) {
    await triggerReembedOnUnexclude({
      shopDomain: session.shop,
      productId: prior.id,
      prior: { recommendationExcluded: prior.recommendationExcluded },
      incoming: { excluded: parsed.data.excluded },
    });
  }

  return Response.json({ ok: true, excluded: parsed.data.excluded });
};

export const loader = () =>
  Response.json({ error: "method_not_allowed" }, { status: 405 });
