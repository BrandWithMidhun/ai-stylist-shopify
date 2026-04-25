// Rules collection endpoints (006a §5.8).
//
// GET  → all rules for the shop, sorted priority asc, createdAt asc.
// POST → create a new rule. conditions/effects validated by rule-engine
//        Zod schemas before write.

import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import {
  ConditionSchema,
  EffectsSchema,
} from "../lib/catalog/rule-engine.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const rules = await prisma.taggingRule.findMany({
    where: { shopDomain: session.shop },
    orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
  });
  return Response.json({ rules });
};

const CreateBodySchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
  enabled: z.boolean().default(true),
  priority: z.number().int().min(0).max(10000).default(100),
  taxonomyNodeId: z.string().nullable().optional(),
  conditions: ConditionSchema,
  effects: EffectsSchema,
});

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") {
    return Response.json({ error: "method_not_allowed" }, { status: 405 });
  }
  const { session } = await authenticate.admin(request);

  const raw = (await request.json()) as unknown;
  const parsed = CreateBodySchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.message }, { status: 400 });
  }
  const data = parsed.data;

  const rule = await prisma.taggingRule.create({
    data: {
      shopDomain: session.shop,
      name: data.name,
      description: data.description ?? null,
      enabled: data.enabled,
      priority: data.priority,
      taxonomyNodeId: data.taxonomyNodeId ?? null,
      conditions: data.conditions as unknown as Prisma.InputJsonValue,
      effects: data.effects as unknown as Prisma.InputJsonValue,
    },
  });
  return Response.json({ rule });
};
