// Taxonomy collection endpoints (006a §4.5).
//
// GET  → full tree as a flat list (the client groups by parentId).
// POST → create a new node. parentSlug is computed from the parent chain so
//        siblings get unique deterministic slugs.

import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { slugFromPath, slugify } from "../lib/catalog/taxonomy";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const nodes = await prisma.taxonomyNode.findMany({
    where: { shopDomain: session.shop },
    orderBy: [{ position: "asc" }, { name: "asc" }],
  });
  return Response.json({ nodes });
};

const AxisOverrideSchema = z.object({
  axis: z.string().min(1).max(64),
  type: z.enum(["single", "multi", "text"]).optional(),
  values: z.array(z.string().min(1).max(128)).optional(),
  order: z.number().int().optional(),
});

const CreateBodySchema = z.object({
  parentId: z.string().nullable().optional(),
  name: z.string().min(1).max(120),
  matchKeywords: z.array(z.string().min(1).max(64)).default([]),
  axisOverrides: z.array(AxisOverrideSchema).default([]),
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
  const { parentId, name, matchKeywords, axisOverrides } = parsed.data;

  let parentSlug = "";
  if (parentId) {
    const parent = await prisma.taxonomyNode.findFirst({
      where: { id: parentId, shopDomain: session.shop },
      select: { slug: true },
    });
    if (!parent) {
      return Response.json({ error: "parent_not_found" }, { status: 404 });
    }
    parentSlug = parent.slug;
  }

  const baseSlug = slugFromPath(parentSlug, name);
  const slug = await ensureUniqueSlug(session.shop, baseSlug);

  const siblingCount = await prisma.taxonomyNode.count({
    where: { shopDomain: session.shop, parentId: parentId ?? null },
  });

  const node = await prisma.taxonomyNode.create({
    data: {
      shopDomain: session.shop,
      parentId: parentId ?? null,
      name,
      slug,
      position: siblingCount,
      axisOverrides: axisOverrides as unknown as Prisma.InputJsonValue,
      matchKeywords,
    },
  });
  return Response.json({ node });
};

// Slug uniqueness is enforced by the unique index. Append `-2`, `-3`, ...
// until we find an unused suffix. Cheap because we only collide on rename
// to an existing sibling name (rare).
async function ensureUniqueSlug(
  shopDomain: string,
  base: string,
): Promise<string> {
  const safe = slugify(base) || "node";
  let slug = safe;
  let i = 2;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const existing = await prisma.taxonomyNode.findFirst({
      where: { shopDomain, slug },
      select: { id: true },
    });
    if (!existing) return slug;
    slug = `${safe}-${i}`;
    i += 1;
    if (i > 1000) return `${safe}-${Date.now()}`;
  }
}
