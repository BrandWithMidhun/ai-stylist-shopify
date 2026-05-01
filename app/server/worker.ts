// Phase 1 (PR-B): catalog sync worker entry point.
//
// Run with: npx tsx app/server/worker.ts
// Railway dispatches via the RAILWAY_RUN_CMD env var on the worker
// service (see docs/operations.md).
//
// Lifecycle:
//   1. Boot — log identity, start health endpoint, register signal
//      handlers, run sweepStuckJobs.
//   2. Claim loop — poll claimNextJob, dispatch to processJob, write
//      the outcome. Sleep 2-5s with jitter when nothing is claimable.
//   3. Graceful shutdown — SIGTERM/SIGINT flips shouldStop. The phase
//      machine checks shouldStop at every batch boundary; on exit, we
//      call releaseJobToQueue so the next worker can claim immediately
//      without waiting for the heartbeat timeout sweep.
//
// Migration discipline (CLAUDE.md): the worker MUST NOT call any
// prisma migrate * command. The image bakes the Prisma client at
// build time; the web service is the only entrypoint that runs
// `prisma migrate deploy` on boot.

import prisma from "../db.server";
import {
  claimNextJob,
  finishJob,
  releaseJobToQueue,
  sweepStuckJobs,
} from "../lib/catalog/sync-jobs.server";
import { sleep } from "../lib/catalog/shopify-throttle.server";
import { processJob } from "./worker-phase";
import { createHealthState, startHealthServer } from "./worker-health";
import { startCronTick } from "./cron-tick.server";
import { log } from "./worker-logger";

const POLL_MIN_MS = 2000;
const POLL_MAX_MS = 5000;

let shouldStop = false;

function jitterPollMs(): number {
  return POLL_MIN_MS + Math.floor(Math.random() * (POLL_MAX_MS - POLL_MIN_MS));
}

async function main(): Promise<void> {
  const health = createHealthState();
  startHealthServer(health);

  log.info("worker boot", {
    nodeVersion: process.version,
    // eslint-disable-next-line no-undef
    nodeEnv: process.env.NODE_ENV ?? "unknown",
    // eslint-disable-next-line no-undef
    pid: process.pid,
  });

  process.on("SIGTERM", () => {
    log.info("SIGTERM received", { willStop: true });
    shouldStop = true;
    health.status = "stopping";
  });
  process.on("SIGINT", () => {
    log.info("SIGINT received", { willStop: true });
    shouldStop = true;
    health.status = "stopping";
  });

  // Boot-time sweep: any RUNNING jobs left over from a prior crash
  // get reset to QUEUED so the claim loop picks them up cleanly.
  const swept = await sweepStuckJobs();
  health.sweepCountAtBoot = swept.resumedJobIds.length;
  log.info("boot sweep complete", {
    sweptCount: swept.resumedJobIds.length,
    resumedJobIds: swept.resumedJobIds,
  });

  // PR-D D.2: spawn the daily cron tick. Runs on a 60s interval
  // alongside the claim loop. Each tick reads MerchantConfig + at
  // most one INSERT/UPDATE per scheduled shop — negligible
  // contention with the claim loop's prisma usage.
  const cronTickHandle = startCronTick(prisma);

  health.status = "ok";

  while (!shouldStop) {
    let job;
    try {
      job = await claimNextJob();
    } catch (err) {
      log.error("claim failed; backing off", {
        message: err instanceof Error ? err.message : String(err),
      });
      await sleep(POLL_MAX_MS);
      continue;
    }

    if (!job) {
      await sleep(jitterPollMs());
      continue;
    }

    health.lastClaimAtMs = Date.now();
    health.currentJobId = job.id;
    health.currentPhase = job.phase;

    log.info("job claimed", {
      jobId: job.id,
      shopDomain: job.shopDomain,
      kind: job.kind,
      resumePhase: job.phase,
      productsCursor: job.productsCursor,
      collectionsCursor: job.collectionsCursor,
    });

    try {
      const outcome = await processJob(
        job,
        () => shouldStop,
        (phase) => {
          health.currentPhase = phase;
        },
      );
      if (outcome.status === "ABORTED") {
        // Graceful shutdown — release the row so the next worker can
        // claim immediately without waiting for the heartbeat sweep.
        await releaseJobToQueue(job.id);
        log.info("job released to queue on shutdown", {
          jobId: job.id,
          shopDomain: job.shopDomain,
          summary: outcome.summary,
        });
      } else {
        await finishJob(job.id, {
          status: "SUCCEEDED",
          summary: outcome.summary,
        });
        log.info("job succeeded", {
          jobId: job.id,
          shopDomain: job.shopDomain,
          summary: outcome.summary,
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error("job failed", {
        jobId: job.id,
        shopDomain: job.shopDomain,
        message,
      });
      await finishJob(job.id, {
        status: "FAILED",
        errorMessage: message,
      });
    } finally {
      health.currentJobId = null;
      health.currentPhase = null;
    }
  }

  log.info("worker exiting", {
    reason: "shouldStop",
  });
  clearInterval(cronTickHandle);
  await prisma.$disconnect();
  // eslint-disable-next-line no-undef
  process.exit(0);
}

main().catch((err) => {
  log.error("worker crashed in main", {
    message: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined,
  });
  // eslint-disable-next-line no-undef
  process.exit(1);
});
