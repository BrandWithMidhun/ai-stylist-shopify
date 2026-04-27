// Phase 1 (PR-A): cost-aware throttle for Shopify Admin GraphQL.
//
// Shopify's leaky bucket: standard plan = 1000 cost points, restoring at
// 50/sec; Plus = 2000/100. Every GraphQL response includes
// `extensions.cost.actualQueryCost` and
// `extensions.cost.throttleStatus.{currentlyAvailable,maximumAvailable,restoreRate}`.
// Reading those after every call lets us slow down before we hit
// THROTTLED, which is far better UX (and faster overall) than reactive
// retry on rate-limit errors.
//
// PR-A scope: just the helpers. PR-B's worker, PR-C's webhook fetcher,
// and PR-D's cron all import from here.

const DEFAULT_BUFFER = 200;

export type ShopifyThrottleStatus = {
  maximumAvailable: number;
  currentlyAvailable: number;
  restoreRate: number;
};

export type ShopifyCostExtension = {
  requestedQueryCost?: number;
  actualQueryCost?: number;
  throttleStatus?: ShopifyThrottleStatus;
};

export type ShopifyGqlResponse<T> = {
  data?: T;
  errors?: Array<{ message: string }>;
  extensions?: { cost?: ShopifyCostExtension };
};

export function extractThrottle<T>(
  response: ShopifyGqlResponse<T>,
): ShopifyThrottleStatus | null {
  return response.extensions?.cost?.throttleStatus ?? null;
}

// Decide how many ms to sleep so that available > buffer when we wake.
// Returns 0 if no sleep is needed.
export function sleepMsForBudget(
  status: ShopifyThrottleStatus | null,
  buffer = DEFAULT_BUFFER,
): number {
  if (!status) return 0;
  if (status.currentlyAvailable >= buffer) return 0;
  const deficit = buffer - status.currentlyAvailable;
  if (status.restoreRate <= 0) {
    // Defensive — restoreRate should always be positive on a Shopify
    // response, but if it's zero we'd divide by zero. Wait one second
    // and retry.
    return 1000;
  }
  return Math.ceil((deficit / status.restoreRate) * 1000);
}

export async function throttleAfter<T>(
  response: ShopifyGqlResponse<T>,
  options?: { buffer?: number },
): Promise<void> {
  const status = extractThrottle(response);
  const ms = sleepMsForBudget(status, options?.buffer ?? DEFAULT_BUFFER);
  if (ms > 0) {
    await sleep(ms);
  }
}

// Tiny helper so callers don't have to import setTimeout. Promise wraps
// the timer; works the same in the worker process and in route handlers.
export function sleep(ms: number): Promise<void> {
  // eslint-disable-next-line no-undef
  return new Promise((resolve) => setTimeout(resolve, ms));
}
