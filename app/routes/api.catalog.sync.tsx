// Phase 1 (PR-A): catalog sync endpoint, now DB-backed.
//
// POST creates a CatalogSyncJob row. Kind is INITIAL when the shop has
// never finished a full sync (lastFullSyncAt is null), MANUAL_RESYNC
// otherwise. createJob handles the DELTA-cancellation transaction for
// MANUAL_RESYNC.
//
// PR-A scope: NO worker process. Jobs created here sit in QUEUED until
// PR-B's worker service picks them up. The dev store already has
// products + lastFullSyncAt set, so its dashboard remains in DASHBOARD
// mode. New empty stores will see EMPTY mode and the Sync button will
// enqueue jobs that don't drain — acceptable interim state.

import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { createJob, getActiveJobForShop } from "../lib/catalog/sync-jobs.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  // Reject if there's already a non-terminal job for this shop. The
  // partial unique index would block a second RUNNING insertion at the
  // DB level, but checking up-front gives the merchant a clean
  // already_running response instead of a 500.
  const existing = await getActiveJobForShop(session.shop);
  if (existing) {
    return Response.json(
      {
        error: "rate_limited",
        reason: "already_running",
        retryAfterSeconds: 30,
        jobId: existing.id,
      },
      { status: 429 },
    );
  }

  const config = await prisma.merchantConfig.findUnique({
    where: { shop: session.shop },
    select: { lastFullSyncAt: true },
  });
  // INITIAL on first sync (mirrors today's behavior); MANUAL_RESYNC
  // afterward. createJob handles atomic DELTA cancellation in the
  // MANUAL_RESYNC transaction.
  const kind = config?.lastFullSyncAt ? "MANUAL_RESYNC" : "INITIAL";
  const job = await createJob({ shopDomain: session.shop, kind });

  return Response.json({ jobId: job.id });
};

export const loader = () => {
  return Response.json({ error: "method_not_allowed" }, { status: 405 });
};
