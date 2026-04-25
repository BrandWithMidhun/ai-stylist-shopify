// Rule mutation endpoints (006a §5.8).
//
// PUT    → partial update. conditions/effects re-validated by rule-engine
//          Zod schemas when supplied.
// DELETE → hard delete (no soft-delete; rules can always be re-created).

import type { ActionFunctionArgs } from "react-router";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import {
  ConditionSchema,
  EffectsSchema,
} from "../lib/catalog/rule-engine.server";

const UpdateBodySchema = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(500).nullable().optional(),
  enabled: z.boolean().optional(),
  priority: z.number().int().min(0).max(10000).optional(),
  taxonomyNodeId: z.string().nullable().optional(),
  conditions: ConditionSchema.optional(),
  effects: EffectsSchema.optional(),
});

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const id = params.id;
  if (!id) {
    return Response.json({ error: "missing_id" }, { status: 400 });
  }

  const rule = await prisma.taggingRule.findFirst({
    where: { id, shopDomain: session.shop },
  });
  if (!rule) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }

  if (request.method === "DELETE") {
    await prisma.taggingRule.delete({ where: { id: rule.id } });
    return Response.json({ ok: true });
  }

  if (request.method !== "PUT") {
    return Response.json({ error: "method_not_allowed" }, { status: 405 });
  }

  const raw = (await request.json()) as unknown;
  const parsed = UpdateBodySchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.message }, { status: 400 });
  }
  const update = parsed.data;

  const data: Prisma.TaggingRuleUpdateInput = {};
  if (update.name !== undefined) data.name = update.name;
  if (update.description !== undefined) data.description = update.description;
  if (update.enabled !== undefined) data.enabled = update.enabled;
  if (update.priority !== undefined) data.priority = update.priority;
  if (update.taxonomyNodeId !== undefined) data.taxonomyNodeId = update.taxonomyNodeId;
  if (update.conditions !== undefined) {
    data.conditions = update.conditions as unknown as Prisma.InputJsonValue;
  }
  if (update.effects !== undefined) {
    data.effects = update.effects as unknown as Prisma.InputJsonValue;
  }

  const updated = await prisma.taggingRule.update({
    where: { id: rule.id },
    data,
  });
  return Response.json({ rule: updated });
};

export const loader = () => {
  return Response.json({ error: "method_not_allowed" }, { status: 405 });
};
