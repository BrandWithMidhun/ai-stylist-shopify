// POST /api/catalog/tags/reset
//
// Destructive bulk-delete of ProductTag rows for the authenticated shop.
// Three scopes: ai_only, all_except_human, everything.
//
// Per 005c decision #6 we write ONE summary ProductTagAudit row per reset
// rather than per-tag — the 005a spec §6.4 wording specified per-tag audits
// but that does not scale to catalogs with tens of thousands of tags. The
// summary row records scope + deletedCount + which sources were removed.
//
// Rate-limited to 1 reset per shop per 60 seconds (separate limiter).

import type { ActionFunctionArgs } from "react-router";
import { z } from "zod";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import {
  checkResetRateLimit,
  markResetCompleted,
} from "../lib/catalog/reset-limiter.server";

const BodySchema = z.object({
  scope: z.enum(["ai_only", "all_except_human", "everything"]),
});

type Scope = z.infer<typeof BodySchema>["scope"];

const SOURCES_BY_SCOPE: Record<Scope, string[]> = {
  ai_only: ["AI"],
  all_except_human: ["AI", "RULE"],
  everything: ["AI", "RULE", "HUMAN"],
};

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") {
    return Response.json(
      { ok: false, error: "method_not_allowed" },
      { status: 405 },
    );
  }

  const { session } = await authenticate.admin(request);

  const limit = checkResetRateLimit(session.shop);
  if (!limit.ok) {
    return Response.json(
      {
        ok: false,
        error: "rate_limited",
        retryAfterSeconds: limit.retryAfterSeconds,
      },
      { status: 429 },
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
  const { scope } = parsed.data;
  const sources = SOURCES_BY_SCOPE[scope];

  const actorId = extractActorId(session);

  const result = await prisma.$transaction(async (tx) => {
    const deleted = await tx.productTag.deleteMany({
      where: { shopDomain: session.shop, source: { in: sources } },
    });

    // Summary audit (decision #6 — one row per reset, not per tag).
    // ProductTagAudit has no metadata JSON column in 005a, so we encode:
    //   axis          -> "reset:{scope}"
    //   newValue      -> deletedCount as string
    //   previousValue -> CSV of removed sources
    //   productId     -> "__shop__" sentinel (no FK on this column)
    // A future schema change can add a real metadata column.
    await tx.productTagAudit.create({
      data: {
        productId: "__shop__",
        shopDomain: session.shop,
        axis: `reset:${scope}`,
        action: "BULK_REMOVE",
        previousValue: sources.join(","),
        newValue: String(deleted.count),
        source: "SYSTEM",
        actorId,
      },
    });

    return deleted.count;
  });

  markResetCompleted(session.shop);

  return Response.json({
    ok: true,
    deletedCount: result,
    scope,
    sources,
  });
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
