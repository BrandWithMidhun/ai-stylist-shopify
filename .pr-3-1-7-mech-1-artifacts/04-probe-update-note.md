# probe-stage-1.ts update — mech.1.5 sweep

The probe at `.pr-3-1-7-planning-artifacts/probe-stage-1.ts` was updated as part of mech.1.5. Two changes:

## 1. `--out=<path>` argument (overwrite-prevention)

The original probe wrote its JSON output to a fixed path
(`.pr-3-1-7-planning-artifacts/14-stage-1-per-fixture-output.json`) — the Thread 2 baseline. Re-running the probe in mech.1.5 (or any later verification) without protection overwrites that baseline, destroying the historical reference point.

Fix: added a `--out=<path>` argument; default path unchanged. Verification reruns must pass `--out` (this commit's run used `--out=.pr-3-1-7-mech-1-artifacts/01-probe-stage-1-post-mech-1.json`). Documented at the top of the probe file.

## 2. Renamed `stage1UniverseStructural` → `stage1InputAfterMech1` + new `productsWithAvailableVariant`

The probe's separate raw-SQL count for "Stage 1 input universe" was constructed pre-mech.1 and included the `EXISTS variant WHERE availableForSale=true` predicate. Pre-mech.1 this WAS the Stage 1 input count (29 on the dev shop). Post-mech.1 D1, that predicate is no longer in Stage 1's WHERE clause; the count it produces (29) is no longer the Stage 1 input — Stage 1 now accepts ~1,169 products.

Running the probe unchanged after mech.1 produced an honest-but-misleading number: `stage1UniverseStructural: 29`, which a future-self auditor would reasonably interpret as "mech.1 didn't land". Per-fixture `candidatesReturned` numbers (1000 on no-hard-filter fixtures, 26 on `category=shirt`, etc.) confirmed mech.1 did land; the universe-level metric was just stale.

Fix:
- Renamed the existing field to `productsWithAvailableVariant` (honest about what the SQL counts: products with at least one available variant).
- Added new field `stage1InputAfterMech1` that runs the SAME structural filters Stage 1 actually uses at HEAD (no variant EXISTS). For the dev shop: 1,169.

Both numbers report in the catalog block of the JSON output; future verification runs see both side-by-side.

## What did NOT change

- The probe still exercises the live `stage1HardFilters()` function (no inline-SQL duplication of Stage 1).
- Per-fixture per-axis aggregation logic unchanged.
- Tag-coverage census unchanged.
- Voyage is still NOT called; no DB writes.
