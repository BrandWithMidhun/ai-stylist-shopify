// Taxonomy node mutation endpoints (006a §4.5).
//
// PUT    → partial update: name, matchKeywords, axisOverrides, parentId,
//          position. Slug is STABLE across rename (Decision 6) — only
//          recomputed when parentId changes.
// DELETE → cascade-deletes children (FK ON DELETE CASCADE). Products
//          previously matched here have their taxonomyNodeId set to null
//          via Product → TaxonomyNode SetNull FK.

import type { ActionFunctionArgs } from "react-router";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { slugFromPath, slugify } from "../lib/catalog/taxonomy";

const AxisOverrideSchema = z.object({
  axis: z.string().min(1).max(64),
  type: z.enum(["single", "multi", "text"]).optional(),
  values: z.array(z.string().min(1).max(128)).optional(),
  order: z.number().int().optional(),
});

const UpdateBodySchema = z.object({
  name: z.string().min(1).max(120).optional(),
  matchKeywords: z.array(z.string().min(1).max(64)).optional(),
  axisOverrides: z.array(AxisOverrideSchema).optional(),
  parentId: z.string().nullable().optional(),
  position: z.number().int().optional(),
});

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const id = params.id;
  if (!id) {
    return Response.json({ error: "missing_id" }, { status: 400 });
  }

  const node = await prisma.taxonomyNode.findFirst({
    where: { id, shopDomain: session.shop },
  });
  if (!node) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }

  if (request.method === "DELETE") {
    await prisma.taxonomyNode.delete({ where: { id: node.id } });
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

  const data: Prisma.TaxonomyNodeUpdateInput = {};
  if (update.name !== undefined) data.name = update.name;
  if (update.matchKeywords !== undefined) data.matchKeywords = update.matchKeywords;
  if (update.axisOverrides !== undefined) {
    data.axisOverrides = update.axisOverrides as unknown as Prisma.InputJsonValue;
  }
  if (update.position !== undefined) data.position = update.position;

  // Slug stability: recompute only when parentId is changing. Renames keep
  // the original slug so any URL referencing it remains valid.
  if (update.parentId !== undefined && update.parentId !== node.parentId) {
    if (update.parentId !== null) {
      const parent = await prisma.taxonomyNode.findFirst({
        where: { id: update.parentId, shopDomain: session.shop },
        select: { id: true, slug: true },
      });
      if (!parent) {
        return Response.json({ error: "parent_not_found" }, { status: 404 });
      }
      // Reject reparenting to a descendant — would create a cycle.
      if (await isDescendant(parent.id, node.id, session.shop)) {
        return Response.json({ error: "cyclical_parent" }, { status: 400 });
      }
      const baseSlug = slugFromPath(parent.slug, update.name ?? node.name);
      data.slug = await ensureUniqueSlug(session.shop, baseSlug, node.id);
      data.parent = { connect: { id: parent.id } };
    } else {
      const baseSlug = slugFromPath("", update.name ?? node.name);
      data.slug = await ensureUniqueSlug(session.shop, baseSlug, node.id);
      data.parent = { disconnect: true };
    }
  }

  const updated = await prisma.taxonomyNode.update({
    where: { id: node.id },
    data,
  });
  return Response.json({ node: updated });
};

async function isDescendant(
  candidateId: string,
  ancestorId: string,
  shopDomain: string,
): Promise<boolean> {
  let cursor: string | null = candidateId;
  for (let i = 0; cursor && i < 16; i += 1) {
    if (cursor === ancestorId) return true;
    const row: { parentId: string | null } | null = await prisma.taxonomyNode.findFirst({
      where: { id: cursor, shopDomain },
      select: { parentId: true },
    });
    if (!row) return false;
    cursor = row.parentId;
  }
  return false;
}

async function ensureUniqueSlug(
  shopDomain: string,
  base: string,
  excludeId: string,
): Promise<string> {
  const safe = slugify(base) || "node";
  let slug = safe;
  let i = 2;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const existing = await prisma.taxonomyNode.findFirst({
      where: { shopDomain, slug, NOT: { id: excludeId } },
      select: { id: true },
    });
    if (!existing) return slug;
    slug = `${safe}-${i}`;
    i += 1;
    if (i > 1000) return `${safe}-${Date.now()}`;
  }
}

export const loader = () => {
  return Response.json({ error: "method_not_allowed" }, { status: 405 });
};
