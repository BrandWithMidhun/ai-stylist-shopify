// Test a draft rule against a single product without writing (006a §5.7).
//
// Body: { rule: { conditions, effects, taxonomyNodeId? }, productId }
// Returns the dry-run applyRules result so the editor can preview which
// axes/values the rule would write.

import type { ActionFunctionArgs } from "react-router";
import type { TaggingRule } from "@prisma/client";
import { z } from "zod";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import {
  applyRules,
  ConditionSchema,
  EffectsSchema,
} from "../lib/catalog/rule-engine.server";
import { STARTER_AXES, type StoreMode } from "../lib/catalog/store-axes";

const BodySchema = z.object({
  productId: z.string().min(1),
  rule: z.object({
    conditions: ConditionSchema,
    effects: EffectsSchema,
    taxonomyNodeId: z.string().nullable().optional(),
    priority: z.number().int().optional(),
  }),
});

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") {
    return Response.json({ error: "method_not_allowed" }, { status: 405 });
  }
  const { session } = await authenticate.admin(request);

  const raw = (await request.json()) as unknown;
  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.message }, { status: 400 });
  }
  const { productId, rule } = parsed.data;

  const product = await prisma.product.findFirst({
    where: { id: productId, shopDomain: session.shop, deletedAt: null },
    include: { tags: true },
  });
  if (!product) {
    return Response.json({ error: "product_not_found" }, { status: 404 });
  }

  const config = await prisma.merchantConfig.findUnique({
    where: { shop: session.shop },
    select: { storeMode: true },
  });
  const mode: StoreMode = ((config?.storeMode ?? null) as StoreMode | null) ?? "GENERAL";

  // Synthesize a transient TaggingRule shape so applyRules can score it
  // without a DB hit. Persisted rules have createdAt/updatedAt which are
  // irrelevant to the evaluator.
  const transient: TaggingRule = {
    id: "test",
    shopDomain: session.shop,
    name: "test",
    description: null,
    enabled: true,
    priority: rule.priority ?? 100,
    taxonomyNodeId: rule.taxonomyNodeId ?? null,
    conditions: rule.conditions as unknown as TaggingRule["conditions"],
    effects: rule.effects as unknown as TaggingRule["effects"],
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const result = await applyRules({
    shopDomain: session.shop,
    product,
    axesNeeded: STARTER_AXES[mode],
    rules: [transient],
    dryRun: true,
  });

  return Response.json({
    matched: result.matchedRuleIds.length > 0,
    tagsWritten: result.tagsWritten,
    axesStillNeeded: result.axesStillNeeded,
  });
};

export const loader = () => {
  return Response.json({ error: "method_not_allowed" }, { status: 405 });
};
