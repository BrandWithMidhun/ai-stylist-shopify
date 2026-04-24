import type { ActionFunctionArgs } from "react-router";
import { z } from "zod";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

const TagInputSchema = z.object({
  axis: z.string().min(1).max(64),
  value: z.string().min(1).max(128),
  locked: z.boolean().optional(),
});

const BodySchema = z.object({
  tags: z.array(TagInputSchema),
  mode: z.enum(["merge", "replace_axis"]).default("merge"),
});

export const action = async ({ request, params }: ActionFunctionArgs) => {
  if (request.method !== "PUT") {
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
  const { tags, mode } = parsed.data;

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

  await prisma.$transaction(async (tx) => {
    const incomingAxes = new Set(tags.map((t) => t.axis));

    if (mode === "replace_axis") {
      for (const axis of incomingAxes) {
        const existing = await tx.productTag.findMany({
          where: { productId: product.id, axis },
          select: { id: true, value: true, source: true },
        });
        for (const row of existing) {
          if (!tags.some((t) => t.axis === axis && t.value === row.value)) {
            await tx.productTag.delete({ where: { id: row.id } });
            await tx.productTagAudit.create({
              data: {
                productId: product.id,
                shopDomain: session.shop,
                axis,
                action: "REMOVE",
                previousValue: row.value,
                newValue: null,
                source: "HUMAN",
                actorId,
              },
            });
          }
        }
      }
    }

    for (const tag of tags) {
      const existing = await tx.productTag.findUnique({
        where: {
          productId_axis_value: {
            productId: product.id,
            axis: tag.axis,
            value: tag.value,
          },
        },
      });

      const desiredLocked = tag.locked ?? true;
      await tx.productTag.upsert({
        where: {
          productId_axis_value: {
            productId: product.id,
            axis: tag.axis,
            value: tag.value,
          },
        },
        create: {
          productId: product.id,
          shopDomain: session.shop,
          axis: tag.axis,
          value: tag.value,
          source: "HUMAN",
          confidence: null,
          locked: desiredLocked,
        },
        update: {
          source: "HUMAN",
          confidence: null,
          locked: desiredLocked,
        },
      });

      if (!existing) {
        await tx.productTagAudit.create({
          data: {
            productId: product.id,
            shopDomain: session.shop,
            axis: tag.axis,
            action: "ADD",
            previousValue: null,
            newValue: tag.value,
            source: "HUMAN",
            actorId,
          },
        });
      }

      if (existing && existing.locked !== desiredLocked) {
        await tx.productTagAudit.create({
          data: {
            productId: product.id,
            shopDomain: session.shop,
            axis: tag.axis,
            action: desiredLocked ? "LOCK" : "UNLOCK",
            previousValue: tag.value,
            newValue: tag.value,
            source: "HUMAN",
            actorId,
          },
        });
      }
    }
  });

  return Response.json({ ok: true });
};

function extractActorId(session: unknown): string | null {
  if (typeof session !== "object" || session === null) return null;
  const s = session as { onlineAccessInfo?: { associated_user?: { id?: unknown } } };
  const id = s.onlineAccessInfo?.associated_user?.id;
  if (typeof id === "number" || typeof id === "string") return String(id);
  return null;
}

export const loader = () => {
  return Response.json({ error: "method_not_allowed" }, { status: 405 });
};
