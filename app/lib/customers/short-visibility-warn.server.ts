// PR-D D.3: end-of-run heuristic for read_all_orders scope clipping.
//
// Symptom: Shopify defaults to a 60-day window of order visibility
// for stores without read_all_orders. The backfill asks for 90 days
// via `created_at:>=YYYY-MM-DD`, but Shopify silently clips to ~60d
// when the scope is unavailable. The signal is the OLDEST order
// observed across the whole run: if it sits at the ~60-day boundary
// while we asked for more, we likely got clipped.
//
// Why end-of-run, not per-customer:
//   - Per-customer "old customer with zero orders" fires a lot of
//     false positives — true zero-order customers are common.
//   - One pass over `min(order.createdAt)` across the run gives a
//     single, sharper signal: oldest-order-age sitting in the
//     55–65d band when we asked for 90d is exactly the symptom of
//     scope clipping. A real read_all_orders store would push the
//     min back to ~90d (or as far as customers actually placed
//     orders).
//
// One-shot:
//   - The helper holds module-level state so a long-running process
//     emits at most one warn per lifetime. Tests reset state via
//     resetShortVisibilityWarnStateForTesting() between cases.
//   - Skipped entirely when totalOrdersFetched === 0 (zero-order
//     shop is a valid state — no signal to clip on).

const READ_ALL_ORDERS_THRESHOLD_DAYS = 60;
const WARN_BAND_LOWER_DAYS = 55;
const WARN_BAND_UPPER_DAYS = 65;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

let alreadyWarned = false;

export function resetShortVisibilityWarnStateForTesting(): void {
  alreadyWarned = false;
}

export type ShortVisibilityCheck = {
  totalOrdersFetched: number;
  configuredWindowDays: number;
  minOrderCreatedAtSeen: Date | null;
  now: Date;
};

// Returns true exactly once per process lifetime when the symptom is
// observed. Subsequent calls — even with the same firing input —
// return false. Calling sites should invoke this once at the end of
// a backfill run, then emit the structured warn if true.
export function shouldEmitShortVisibilityWarn(
  input: ShortVisibilityCheck,
): boolean {
  if (alreadyWarned) return false;
  if (input.totalOrdersFetched <= 0) return false;
  if (input.configuredWindowDays <= READ_ALL_ORDERS_THRESHOLD_DAYS) return false;
  if (!input.minOrderCreatedAtSeen) return false;
  const ageMs = input.now.getTime() - input.minOrderCreatedAtSeen.getTime();
  const ageDays = ageMs / MS_PER_DAY;
  if (ageDays < WARN_BAND_LOWER_DAYS) return false;
  if (ageDays > WARN_BAND_UPPER_DAYS) return false;
  alreadyWarned = true;
  return true;
}
