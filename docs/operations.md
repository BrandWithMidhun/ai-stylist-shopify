# Operations runbook

Operational procedures for running the AI Stylist app in production on Railway.

## Services

The Railway project hosts two services off the same Dockerfile:

| Service | Purpose | Start command (via `RAILWAY_RUN_CMD`) | HTTP port |
|---|---|---|---|
| Web (existing) | React Router 7 app — embed UI, API routes, theme app extension origin | unset → defaults to `npm run docker-start` | Public, traffic |
| Worker (PR-B) | Catalog sync worker — drains `CatalogSyncJob` rows | `npx tsx app/server/worker.ts` | Internal-only, health probe |

Both run the same Docker image. The dispatch happens at container start via the `RAILWAY_RUN_CMD` env var, which the Dockerfile's `CMD` reads. Web doesn't set it; worker does.

## One-time worker service creation

After the first `main` push that contains the worker code (PR-B commit 2 onward):

1. Open the Railway project dashboard.
2. **New → Empty Service** (or **New → GitHub Repo** if creating fresh; pick the same repo and `main` branch).
3. Settings → Source → confirm the repo + branch + Dockerfile path match the web service.
4. Settings → Variables:
   - Set service-specific variable: `RAILWAY_RUN_CMD=npx tsx app/server/worker.ts`
   - Reference all shared variables (see below) so they apply to this service too.
5. Settings → Deploy → ensure auto-deploy on `main` push is enabled.
6. Trigger the first deploy. Wait until logs show:
   ```
   {"level":"info","service":"worker","msg":"worker boot",...}
   {"level":"info","service":"worker","msg":"health endpoint listening","port":...}
   {"level":"info","service":"worker","msg":"boot sweep complete","sweptCount":0,"resumedJobIds":[]}
   ```

## Required shared environment variables

Configure these as **shared variables** at the Railway project level so both services pick them up:

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection string. Same DB for both services. |
| `SHOPIFY_API_KEY` | Shopify Admin API key |
| `SHOPIFY_API_SECRET` | Shopify Admin API secret |
| `SCOPES` | Shopify OAuth scopes |
| `SHOPIFY_APP_URL` | Public URL of the web service |
| `ANTHROPIC_API_KEY` | Anthropic SDK key (chat agent) |
| `VOYAGE_API_KEY` | Voyage embeddings (Phase 3) |
| `NODE_ENV` | `production` |

## Optional shared environment variables

| Variable | Default | Purpose |
|---|---|---|
| `KNOWLEDGE_WORKER_HEARTBEAT_TIMEOUT_MS` | `300000` (5 min) | How long a RUNNING job goes without a heartbeat before `sweepStuckJobs` resets it to QUEUED |
| `WORKER_LOG_LEVEL` | `info` | One of `debug`, `info`, `warn`, `error` |
| `CRON_HOUR` | `3` | Local hour (0-23, in each shop's timezone) at which the daily catch-up DELTA fires. Apply on the worker service only — web doesn't read it. |
| `CRON_FORCE_TICK_NOW` | unset | When set to `"1"` at worker boot, the cron tick fires one immediate enqueue regardless of local hour, then resets and resumes normal scheduling. Boot-once flag (matches PR-B `sweepStuckJobs` pattern). Use for verification after schema changes; safe to leave unset afterward. |

## Worker-specific variables

Set on the worker service only (not shared):

| Variable | Value | Purpose |
|---|---|---|
| `RAILWAY_RUN_CMD` | `npx tsx app/server/worker.ts` | Overrides the Dockerfile default to start the worker instead of the web server |

## Redeploy procedure

Worker deploys are triggered the same way as web deploys — push to `main` and Railway picks up the change. The graceful shutdown handler responds to Railway's SIGTERM:

1. Railway sends SIGTERM to the running worker.
2. The worker sets `shouldStop = true` and the health endpoint returns 503.
3. The current per-batch transaction completes (last cursor save commits inside it).
4. The worker calls `releaseJobToQueue(jobId)` so the row goes back to QUEUED.
5. Prisma disconnects, process exits 0.
6. Railway boots the new image. The new worker's `sweepStuckJobs` finds nothing stale (heartbeat was fresh at handoff) and the claim loop re-claims the just-released job, resuming from cursor.

If the SIGTERM grace window (Railway default 30s) is shorter than the per-batch processing time, the worker will be SIGKILLed. The job stays RUNNING with a stale heartbeat; the next worker boot's sweep recovers it after 5 minutes. Increase Railway's grace window if this is observed in practice.

## Health check

Curl from inside the Railway project (or via the public URL if exposed):

```
curl https://<worker-internal-or-public-url>/health
```

Returns:
```json
{
  "status": "ok",
  "bootedAt": "2026-04-28T...",
  "uptimeMs": 1234567,
  "lastClaimAt": "2026-04-28T...",
  "currentJobId": "ckxxx...",
  "currentPhase": "PRODUCTS",
  "sweepCountAtBoot": 0
}
```

`status` is `starting` during boot, `ok` once ready, `503` (HTTP status) + `stopping` when SIGTERM is acknowledged.

## Daily catch-up cron (PR-D)

The worker hosts an in-process cron tick on a 60s interval (alongside the claim loop). Each tick:

1. Reads all `MerchantConfig` rows.
2. Computes local hour per `MerchantConfig.timezone` (IANA, e.g. `Asia/Kolkata`) via `Intl.DateTimeFormat`.
3. If local hour matches `CRON_HOUR` (default 3) AND `lastCronEnqueueDate` ≠ today's local date, calls `enqueueDeltaForShop(shop, { topic: "cron", triggerSource: "CRON" })` and stamps `lastCronEnqueueDate`.
4. Lazy-refreshes `MerchantConfig.timezone` from Shopify `shop.ianaTimezone` once per shop per day (when `timezoneSyncedAt` is null or > 24h old).

The cron-driven DELTA flows through the same worker phase machine as webhook-driven and manual DELTAs; the only difference is `CatalogSyncJob.triggerSource = "CRON"` for cron-originated rows.

Per-shop errors during a tick are logged structured and isolated — one bad shop doesn't poison the rest of the loop. The interval keeps running on the next 60s tick.

### Force-fire one tick (verification)

To exercise the cron path immediately after a schema change or migration without waiting for the local-hour gate:

1. Set `CRON_FORCE_TICK_NOW=1` on the worker service in Railway.
2. Restart the worker. Boot logs include `cron tick force-fire requested`.
3. The first tick (within ~60s of boot) enqueues a DELTA for every shop regardless of local hour. Subsequent ticks honor normal scheduling.
4. Optionally clear the env var. Leaving it set is harmless — it only fires once per boot.

Verify the enqueue with:

```
psql $DATABASE_URL -c "SELECT id, \"shopDomain\", \"triggerSource\", status, \"enqueuedAt\" FROM \"CatalogSyncJob\" WHERE \"triggerSource\" = 'CRON' ORDER BY \"enqueuedAt\" DESC LIMIT 5;"
```

## Manual test scripts (post-deploy)

After the worker is live, two scripts verify the first INITIAL backfill end-to-end:

### Enqueue a fresh INITIAL job

```
npx tsx scripts/enqueue-initial.ts <shop-domain>
```

Prints the created `jobId`. The worker picks it up within 2-5 seconds. Watch progress in Railway logs or via:

```
psql $DATABASE_URL -c "SELECT id, status, phase, processedProducts, totalProducts, failedProducts FROM \"CatalogSyncJob\" ORDER BY \"enqueuedAt\" DESC LIMIT 5;"
```

### Verify completion

```
npx tsx scripts/verify-initial-run.ts <shop-domain>
```

Compares Shopify's live product count against the local DB count, asserts every product has `knowledgeContentHash` and `lastKnowledgeSyncAt`, asserts `MerchantConfig.lastKnowledgeSyncAt` is fresh, and spot-checks 3 products with metafields/metaobjects/collections. Prints a PASS/FAIL summary.

## Migration discipline

**The worker MUST NOT run `prisma migrate dev`, `prisma migrate reset`, or `prisma db push`.** Migrations run only on the web service's boot (`npm run docker-start` → `npm run setup` → `prisma migrate deploy`). The Dockerfile bakes the Prisma client at build time so the worker has a generated client without needing to run `prisma generate` at boot.

If a future PR introduces a schema change, the migration SQL must be authored by hand (using `prisma migrate diff` for read-only inspection) and committed to `prisma/migrations/`. It applies on the next web service deploy.
