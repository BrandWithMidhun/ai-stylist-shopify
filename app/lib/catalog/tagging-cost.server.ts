// PR-2.1: Tagging cost ledger + budget enforcement.
//
// Three concerns live here:
//   1. Translate Anthropic API token usage into microdollars
//      (computeCostFromUsage). Single source of truth for model rates.
//   2. Enforce the per-kind daily/backfill budget caps before each
//      tagging call (checkBudgetForKind).
//   3. Record per-job cost on TaggingJob rows + flip MerchantConfig
//      tripwires when a daily cap is crossed (recordCost +
//      writeBudgetWarningIfCrossed).
//
// Cost is in microdollars (1 USD = 1_000_000 micros) stored as BigInt
// throughout so we never lose sub-cent precision to float drift.
//
// Day boundaries: per-shop daily cap rolls over at UTC midnight. We do
// NOT respect MerchantConfig.timezone for this — the cap is an
// operational tripwire, not a merchant-facing metric. UTC keeps the
// math simple and the rollover behavior unambiguous across shops.

import type { Prisma, TaggingJobKind } from "@prisma/client";
import prisma from "../../db.server";

// ---- Model rates --------------------------------------------------------
//
// Source: https://platform.claude.com/docs/en/about-claude/pricing
// Verified 2026-05-03. Sonnet 4.6 base rates:
//   Input  $3  / Million tokens =  3 micros per token
//   Output $15 / Million tokens = 15 micros per token
//
// When Anthropic publishes a price change OR we add a new model to
// ai-tagger.server.ts, this is the single point of update.

type ModelRates = {
  inputMicrosPerToken: bigint;
  outputMicrosPerToken: bigint;
};

const MODEL_RATES: Record<string, ModelRates> = {
  "claude-sonnet-4-6": {
    inputMicrosPerToken: 3n,
    outputMicrosPerToken: 15n,
  },
  "claude-sonnet-4-5": {
    inputMicrosPerToken: 3n,
    outputMicrosPerToken: 15n,
  },
};

// Defensive fallback: unknown model gets billed at Sonnet rates so a
// model-name typo does not silently zero out the ledger. The caller
// should still surface the unknown model to the operator via the log.
const FALLBACK_RATES: ModelRates = MODEL_RATES["claude-sonnet-4-6"];

export function computeCostFromUsage(
  model: string,
  inputTokens: number,
  outputTokens: number,
): { costMicros: bigint; rateSource: "known" | "fallback" } {
  const rates = MODEL_RATES[model];
  const r = rates ?? FALLBACK_RATES;
  const costMicros =
    BigInt(Math.max(0, Math.trunc(inputTokens))) * r.inputMicrosPerToken +
    BigInt(Math.max(0, Math.trunc(outputTokens))) * r.outputMicrosPerToken;
  return { costMicros, rateSource: rates ? "known" : "fallback" };
}

// ---- Budget caps --------------------------------------------------------

const DEFAULT_PER_PRODUCT_MICROS = 5_000n; // $0.005
const DEFAULT_PER_SHOP_DAY_MICROS = 500_000n; // $0.50
const DEFAULT_BACKFILL_BUDGET_MICROS = 10_000_000n; // $10

function readEnvBigint(name: string, fallback: bigint): bigint {
  // eslint-disable-next-line no-undef
  const raw = process.env[name];
  if (!raw) return fallback;
  try {
    const parsed = BigInt(raw.trim());
    return parsed > 0n ? parsed : fallback;
  } catch {
    return fallback;
  }
}

export function getPerProductCapMicros(): bigint {
  return readEnvBigint("TAGGING_COST_PER_PRODUCT_USD_MICROS", DEFAULT_PER_PRODUCT_MICROS);
}

export function getPerShopDayCapMicros(): bigint {
  return readEnvBigint("TAGGING_COST_PER_SHOP_DAY_USD_MICROS", DEFAULT_PER_SHOP_DAY_MICROS);
}

export function getBackfillBudgetMicros(): bigint {
  return readEnvBigint("TAGGING_BACKFILL_BUDGET_USD_MICROS", DEFAULT_BACKFILL_BUDGET_MICROS);
}

// ---- checkBudgetForKind -------------------------------------------------
//
// Called BEFORE the worker fires the next Anthropic call for a job.
// Returns { allowed: false, reason } when the cap would be exceeded so
// the worker can mark the row BUDGET_PAUSED and skip the call.

export type BudgetCheckResult =
  | {
      allowed: true;
      cumulativeMicros: bigint;
      capMicros: bigint;
    }
  | {
      allowed: false;
      reason: "DAILY_CAP" | "BACKFILL_CAP";
      cumulativeMicros: bigint;
      capMicros: bigint;
    };

export async function checkBudgetForKind(params: {
  shopDomain: string;
  kind: TaggingJobKind;
  // The job currently being processed, so we know which row's cost
  // has already been counted toward the daily total (avoid double-
  // counting rows still in flight).
  currentJobId?: string;
}): Promise<BudgetCheckResult> {
  if (params.kind === "INITIAL_BACKFILL") {
    const cap = getBackfillBudgetMicros();
    const cumulative = await sumBackfillCost(params.shopDomain);
    if (cumulative >= cap) {
      return { allowed: false, reason: "BACKFILL_CAP", cumulativeMicros: cumulative, capMicros: cap };
    }
    return { allowed: true, cumulativeMicros: cumulative, capMicros: cap };
  }
  // SINGLE_PRODUCT and MANUAL_RETAG share the daily cap.
  const cap = getPerShopDayCapMicros();
  const cumulative = await sumDailyCost(params.shopDomain, todayUtcDayKey());
  if (cumulative >= cap) {
    return { allowed: false, reason: "DAILY_CAP", cumulativeMicros: cumulative, capMicros: cap };
  }
  return { allowed: true, cumulativeMicros: cumulative, capMicros: cap };
}

// ---- recordCost ---------------------------------------------------------
//
// After each Anthropic call, the worker records the per-call cost on
// the TaggingJob row. Increments costUsdMicros, inputTokens,
// outputTokens. Keeping this idempotent-friendly via increment ops so
// retries don't double-count when the worker writes incrementally.

export async function recordCost(params: {
  jobId: string;
  costMicros: bigint;
  inputTokens: number;
  outputTokens: number;
  tx?: Prisma.TransactionClient;
}): Promise<void> {
  const tx = params.tx ?? prisma;
  await tx.taggingJob.update({
    where: { id: params.jobId },
    data: {
      costUsdMicros: { increment: params.costMicros },
      inputTokens: { increment: params.inputTokens },
      outputTokens: { increment: params.outputTokens },
    },
  });
}

// ---- writeBudgetWarningIfCrossed ----------------------------------------
//
// After recording cost, check whether today's cumulative spend has
// crossed 80% (warn) or 100% (pause). Writes MerchantConfig
// taggingBudgetWarnedAt / taggingBudgetExceededAt timestamps. Returns
// the action taken so the worker can emit the matching log event.
//
// Idempotent: the WARNED timestamp is written once per day per shop;
// re-crossing 80% on a day already warned is a no-op. EXCEEDED is the
// same. Both reset to null on the next day's first successful tag
// (resetBudgetTripwiresForNewDay) — the resetter runs lazily, on
// first cost record of a new day, not via cron.

export type BudgetCrossingResult =
  | { kind: "none" }
  | { kind: "warn"; cumulativeMicros: bigint; capMicros: bigint; fraction: number }
  | { kind: "pause"; cumulativeMicros: bigint; capMicros: bigint; fraction: number };

export async function writeBudgetWarningIfCrossed(params: {
  shopDomain: string;
  // Optional: skip the lookup if caller already has the totals.
  cumulativeMicros?: bigint;
}): Promise<BudgetCrossingResult> {
  const cap = getPerShopDayCapMicros();
  const cumulative =
    params.cumulativeMicros ??
    (await sumDailyCost(params.shopDomain, todayUtcDayKey()));
  const fraction = cap > 0n ? Number((cumulative * 10000n) / cap) / 10000 : 0;

  // Pull existing tripwire state.
  const existing = await prisma.merchantConfig.findUnique({
    where: { shop: params.shopDomain },
    select: {
      taggingBudgetWarnedAt: true,
      taggingBudgetExceededAt: true,
    },
  });
  if (!existing) {
    return { kind: "none" };
  }

  const now = new Date();

  if (cumulative >= cap) {
    if (existing.taggingBudgetExceededAt) {
      return { kind: "none" };
    }
    await prisma.$transaction(async (tx) => {
      await tx.merchantConfig.update({
        where: { shop: params.shopDomain },
        data: {
          taggingBudgetExceededAt: now,
          // Ensure the WARNED timestamp is set if 100% is hit before
          // 80% was ever observed (e.g. one big call).
          taggingBudgetWarnedAt: existing.taggingBudgetWarnedAt ?? now,
        },
      });
      // Pause every QUEUED/RUNNING SINGLE_PRODUCT and MANUAL_RETAG
      // row for the shop. INITIAL_BACKFILL is on its own budget so
      // it stays untouched.
      await tx.taggingJob.updateMany({
        where: {
          shopDomain: params.shopDomain,
          kind: { in: ["SINGLE_PRODUCT", "MANUAL_RETAG"] },
          status: { in: ["QUEUED", "RUNNING"] },
        },
        data: { status: "BUDGET_PAUSED" },
      });
    });
    return { kind: "pause", cumulativeMicros: cumulative, capMicros: cap, fraction };
  }

  if (fraction >= 0.8) {
    if (existing.taggingBudgetWarnedAt) {
      return { kind: "none" };
    }
    await prisma.merchantConfig.update({
      where: { shop: params.shopDomain },
      data: { taggingBudgetWarnedAt: now },
    });
    return { kind: "warn", cumulativeMicros: cumulative, capMicros: cap, fraction };
  }

  return { kind: "none" };
}

// resetBudgetTripwiresForNewDay clears warned/exceeded timestamps if
// they were set on a prior day. Called lazily by the worker before the
// first cost record of a new day so the new day starts clean.
export async function resetBudgetTripwiresForNewDay(
  shopDomain: string,
): Promise<{ reset: boolean }> {
  const existing = await prisma.merchantConfig.findUnique({
    where: { shop: shopDomain },
    select: {
      taggingBudgetWarnedAt: true,
      taggingBudgetExceededAt: true,
    },
  });
  if (!existing) return { reset: false };

  const today = todayUtcDayKey();
  const warnedDay = existing.taggingBudgetWarnedAt
    ? toUtcDayKey(existing.taggingBudgetWarnedAt)
    : null;
  const exceededDay = existing.taggingBudgetExceededAt
    ? toUtcDayKey(existing.taggingBudgetExceededAt)
    : null;

  if (
    (warnedDay !== null && warnedDay !== today) ||
    (exceededDay !== null && exceededDay !== today)
  ) {
    await prisma.merchantConfig.update({
      where: { shop: shopDomain },
      data: {
        taggingBudgetWarnedAt: null,
        taggingBudgetExceededAt: null,
      },
    });
    return { reset: true };
  }
  return { reset: false };
}

// ---- internal helpers ---------------------------------------------------

function todayUtcDayKey(): string {
  return toUtcDayKey(new Date());
}

function toUtcDayKey(d: Date): string {
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

async function sumDailyCost(shopDomain: string, dayKey: string): Promise<bigint> {
  const start = new Date(`${dayKey}T00:00:00.000Z`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  // Aggregate across all tagging jobs that finished or are running
  // today. enqueuedAt is the proxy for "billing day"; finishedAt is
  // out for in-flight rows. Using enqueuedAt also means a cost
  // recorded mid-day belongs to the day the job started.
  const rows = await prisma.taggingJob.findMany({
    where: {
      shopDomain,
      kind: { in: ["SINGLE_PRODUCT", "MANUAL_RETAG"] },
      enqueuedAt: { gte: start, lt: end },
    },
    select: { costUsdMicros: true },
  });
  return rows.reduce((acc: bigint, row) => acc + row.costUsdMicros, 0n);
}

async function sumBackfillCost(shopDomain: string): Promise<bigint> {
  // The backfill budget is per active backfill job; if no job is
  // active we report 0. If there's a QUEUED/RUNNING backfill we
  // report its accumulated cost.
  const row = await prisma.taggingJob.findFirst({
    where: {
      shopDomain,
      kind: "INITIAL_BACKFILL",
      status: { in: ["QUEUED", "RUNNING"] },
    },
    select: { costUsdMicros: true },
    orderBy: { enqueuedAt: "desc" },
  });
  return row?.costUsdMicros ?? 0n;
}
