// PR-D D.2: in-worker daily cron tick.
//
// Spawned by worker.ts as a setInterval(60_000) alongside the claim
// loop. Each tick:
//   1. Reads all MerchantConfig rows.
//   2. For each shop, computes the local hour via Intl.DateTimeFormat
//      with the shop's timezone column.
//   3. If forceNextTick is set (CRON_FORCE_TICK_NOW=1 at worker boot),
//      runs the enqueue regardless of hour for one tick, then resets.
//   4. Otherwise, enqueues a DELTA job IFF:
//        - localHour === CRON_HOUR (default 3)
//        - lastCronEnqueueDate !== today's local date
//      The lastCronEnqueueDate guard makes the tick idempotent across
//      the 60s tick window — no duplicate enqueues at 03:00:00,
//      03:01:00, ... within the same local day.
//   5. Refreshes timezone lazily — once per day per shop, when
//      timezoneSyncedAt is null or > 24h old.
//
// Latency contract: tick completes in <100ms for a small merchant set
// (one DB read for all configs, at most one INSERT + one UPDATE per
// shop scheduled to run). Negligible contention with the claim loop.
//
// Failure isolation: per-shop errors are caught and logged so a bad
// row doesn't poison the rest of the tick. The interval keeps running.

import type { PrismaClient } from "@prisma/client";
import { enqueueDeltaForShop } from "../lib/webhooks/enqueue-delta.server";
import { refreshShopTimezone } from "../lib/cron/timezone-refresh.server";
import { log } from "./worker-logger";

const TICK_INTERVAL_MS = 60_000;
const TIMEZONE_REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;

// Module-level state. Boot-once flag mirrors the PR-B sweepStuckJobs
// pattern — fire once on the first tick after boot, then resume normal
// schedule.
let forceNextTick = process.env.CRON_FORCE_TICK_NOW === "1";

export function getForceNextTickFlag(): boolean {
  return forceNextTick;
}

// Compute the shop's local date+hour from a UTC instant + IANA tz.
// Intl.DateTimeFormat is built-in; no external deps. Returns the
// hour as a number (0-23) and the date as YYYY-MM-DD in the shop's
// timezone — used for the lastCronEnqueueDate idempotency guard.
export function computeLocalHourAndDate(
  now: Date,
  timezone: string,
): { localHour: number; localDate: string } {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "numeric",
    hour12: false,
  });
  const parts = formatter.formatToParts(now);
  const lookup: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== "literal") lookup[part.type] = part.value;
  }
  // hour can come back as "24" in some TZ DST edge cases — normalize.
  const rawHour = Number(lookup.hour ?? "0");
  const localHour = rawHour === 24 ? 0 : rawHour;
  const localDate = `${lookup.year}-${lookup.month}-${lookup.day}`;
  return { localHour, localDate };
}

function getCronHour(): number {
  const raw = process.env.CRON_HOUR;
  if (!raw) return 3;
  const parsed = Number(raw);
  if (Number.isNaN(parsed) || parsed < 0 || parsed > 23) return 3;
  return parsed;
}

export type CronTickResult = {
  evaluatedShops: number;
  enqueuedShops: number;
  skippedAlreadyEnqueued: number;
  skippedOutOfWindow: number;
  timezoneRefreshes: number;
  errors: number;
};

export async function runCronTick(
  prisma: PrismaClient,
  now: Date = new Date(),
): Promise<CronTickResult> {
  const cronHour = getCronHour();
  const force = forceNextTick;
  if (force) {
    log.info("cron tick force-fire requested", { cronHour });
  }

  const configs = await prisma.merchantConfig.findMany({
    select: {
      shop: true,
      timezone: true,
      timezoneSyncedAt: true,
      lastCronEnqueueDate: true,
    },
  });

  const result: CronTickResult = {
    evaluatedShops: configs.length,
    enqueuedShops: 0,
    skippedAlreadyEnqueued: 0,
    skippedOutOfWindow: 0,
    timezoneRefreshes: 0,
    errors: 0,
  };

  for (const config of configs) {
    try {
      // Lazy timezone refresh — once per day per shop. Refresh BEFORE
      // computing local hour so a stale "UTC" default for a freshly
      // installed shop doesn't fire at the wrong local time.
      const stale =
        config.timezoneSyncedAt === null ||
        now.getTime() - config.timezoneSyncedAt.getTime() >
          TIMEZONE_REFRESH_INTERVAL_MS;
      let timezone = config.timezone;
      if (stale) {
        const refresh = await refreshShopTimezone(config.shop, prisma);
        result.timezoneRefreshes += 1;
        if (refresh.ianaTimezone) timezone = refresh.ianaTimezone;
      }

      const { localHour, localDate } = computeLocalHourAndDate(now, timezone);

      const inWindow = localHour === cronHour;
      const lastEnqueue = config.lastCronEnqueueDate
        ? formatDateUTC(config.lastCronEnqueueDate)
        : null;
      const alreadyEnqueuedToday = lastEnqueue === localDate;

      if (!force && !inWindow) {
        result.skippedOutOfWindow += 1;
        continue;
      }
      if (!force && alreadyEnqueuedToday) {
        result.skippedAlreadyEnqueued += 1;
        continue;
      }

      const enqueue = await enqueueDeltaForShop(config.shop, {
        topic: "cron",
        webhookId: `cron-${localDate}-${cronHour}`,
        resourceGid: null,
        triggerSource: "CRON",
      });

      // Stamp lastCronEnqueueDate to the local date so subsequent ticks
      // within the same day are idempotent. Stored as a DATE column —
      // pass a Date constructed from localDate (midnight UTC suffices
      // since DATE has no time component).
      await prisma.merchantConfig.update({
        where: { shop: config.shop },
        data: { lastCronEnqueueDate: new Date(`${localDate}T00:00:00.000Z`) },
      });

      log.info("cron tick enqueued delta", {
        shop: config.shop,
        timezone,
        localHour,
        localDate,
        cronHour,
        force,
        jobId: enqueue.jobId,
        deduped: enqueue.deduped,
      });

      result.enqueuedShops += 1;
    } catch (err) {
      result.errors += 1;
      log.error("cron tick per-shop error", {
        shop: config.shop,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (force) {
    forceNextTick = false;
    log.info("cron tick force-fire consumed; resuming normal schedule", {});
  }

  return result;
}

// Returns YYYY-MM-DD in UTC for a Date stored as @db.Date. Postgres
// DATE columns round-trip through Prisma as Date objects at midnight
// UTC, so toISOString().slice(0, 10) is correct.
function formatDateUTC(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// Test helper. Allows redact.test-style unit tests to reset the boot
// flag between cases without spawning a fresh module.
export function __resetForceNextTickForTesting(value: boolean): void {
  forceNextTick = value;
}

export function startCronTick(prisma: PrismaClient): NodeJS.Timeout {
  log.info("cron tick scheduler starting", {
    intervalMs: TICK_INTERVAL_MS,
    cronHour: getCronHour(),
    forceFirstTick: forceNextTick,
  });
  return setInterval(() => {
    runCronTick(prisma).catch((err) => {
      log.error("cron tick top-level error", {
        message: err instanceof Error ? err.message : String(err),
      });
    });
  }, TICK_INTERVAL_MS);
}
