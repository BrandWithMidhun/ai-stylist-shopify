// PR-D D.3: minor-unit conversion for Shopify Money strings.
//
// Shopify returns Money.amount as a decimal string like "29.95",
// "1000", or "100.5". CustomerEvent.context stores integer
// minor-unit values (totalCents, unitPriceCents) so downstream
// analytics queries can sum without float drift.
//
// Sub-unit handling per ISO 4217:
//   - 0-decimal currencies (JPY, KRW, VND, ISK, CLP, ...): the
//     "amount" string is already a whole-unit count. Multiply by 1.
//   - 2-decimal currencies (USD, EUR, GBP, INR, AUD, ...): default;
//     multiply by 100, round to nearest int to absorb float noise.
//   - 3-decimal currencies (KWD, BHD, JOD, OMR, TND): TODO: implement
//     proper *1000 conversion when we ship into those markets. Today
//     they round to two-decimal cents (slight rounding error rather
//     than a script-fatal crash) AND emit a one-shot structured warn
//     so a real 3-decimal payload surfaces in logs the first time
//     it's encountered per process.
//
// The set of zero-decimal currencies is hard-coded rather than
// derived from a runtime locale lookup — Intl.NumberFormat could
// answer this but pulls Node's full ICU surface, which the worker
// build doesn't ship. The list below covers every zero-decimal
// currency in ISO 4217 as of 2024.

const ZERO_DECIMAL_CURRENCIES = new Set<string>([
  "BIF",
  "CLP",
  "DJF",
  "GNF",
  "ISK",
  "JPY",
  "KMF",
  "KRW",
  "PYG",
  "RWF",
  "UGX",
  "UYI",
  "VND",
  "VUV",
  "XAF",
  "XOF",
  "XPF",
]);

// TODO: extend parsePriceToInt to multiply by 1000 (and skip the
// 2-decimal Math.round path) for these currencies once we ship into
// any market that uses them. Tracked via the one-shot warn below.
const THREE_DECIMAL_CURRENCIES = new Set<string>([
  "BHD",
  "IQD",
  "JOD",
  "KWD",
  "LYD",
  "OMR",
  "TND",
]);

// Module-level fire-once gate for the 3-decimal warn. Reset between
// tests via resetPriceWarnStateForTesting() so the test order doesn't
// affect the spy assertions; in production this lives the lifetime
// of the process (one warn per backfill / worker run, not per
// payload).
let alreadyWarned3Decimal = false;

export function resetPriceWarnStateForTesting(): void {
  alreadyWarned3Decimal = false;
}

export function parsePriceToInt(amount: string, currencyCode: string): number {
  const normalized = (currencyCode ?? "").trim().toUpperCase();
  const parsed = Number.parseFloat(amount);
  if (!Number.isFinite(parsed)) {
    throw new Error(
      `parsePriceToInt: non-numeric amount "${amount}" for currency ${normalized}`,
    );
  }
  if (ZERO_DECIMAL_CURRENCIES.has(normalized)) {
    return Math.round(parsed);
  }
  if (THREE_DECIMAL_CURRENCIES.has(normalized) && !alreadyWarned3Decimal) {
    alreadyWarned3Decimal = true;
    // eslint-disable-next-line no-console
    console.warn(
      JSON.stringify({
        event: "price_3decimal_encountered",
        level: "warn",
        currency: normalized,
        amount,
        action: "rounded_to_2decimal",
        note: "TODO: implement *1000 minor-unit conversion for 3-decimal ISO 4217 currencies",
      }),
    );
  }
  // Default: 2-decimal. The 3-decimal currencies round to two-decimal
  // cents here; flagged as a TODO: above and surfaced via the warn.
  return Math.round(parsed * 100);
}
