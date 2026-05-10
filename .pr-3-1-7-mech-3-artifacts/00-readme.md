# .pr-3-1-7-mech-3-artifacts — mech.3 evidentiary artifacts

This directory captures the artifacts of 3.1.7 mech.3 (bulk-approve
secondary axes). The chain was non-trivial:

1. **mech.3 paused mid-flight.** The dry-run revealed 22.8% of the 404
   PENDING_REVIEW candidates were sub-0.8 AI-tagger confidence
   (size_range outlier at 75%). The original mech.3 prompt's
   discipline reminder triggered a STOP-and-surface — extending the
   bulk-approve script with a confidence filter is a separate
   tool-change concern.

2. **mech.3a landed (`ef9a61f`).** Single-file commit extending
   `scripts/bulk-approve-tags.ts` with `--min-confidence=<float>`
   flag. Default 0 preserves backward-compat with 3.1 mech.6's
   (gender, category) baseline invocation.

3. **mech.3 resumed (this commit).** Re-invoked the post-mech.3a
   script with `--min-confidence=0.8`. The live pass landed in two
   waves due to a transient Railway proxy disconnect (Prisma `P1017:
   Server has closed the connection`) after batch 1:
   - **Wave 1 (artifact 03):** 50/312 rows flipped, then connection
     drop, script exited with code 1.
   - **Partial-state inspection (artifact 03a):** confirmed 50
     APPROVED via the `actorId` audit trail, 262 high-confidence
     PENDING_REVIEW remaining, 92 sub-0.8 PENDING_REVIEW unchanged.
   - **Wave 2 (artifact 03b):** re-invoked the script with the same
     args; its `status: 'PENDING_REVIEW'` candidate filter saw only
     the 262 remaining rows; all 262 flipped successfully in one
     contiguous batch sequence.

   End state: **312 APPROVED across the seven axes** (66 + 48 + 51 +
   39 + 48 + 15 + 45 = 312 ✓), audit trail shows two waves under the
   same `actorId='system://3.1.7-mech.3-bulk-approve'`. The 92 sub-
   0.8 candidates remain PENDING_REVIEW (logged as op debt for future
   merchant-review-portal work).

## Files

| File | Captured during | What it shows |
|------|-----------------|---------------|
| 00-readme.md | mech.3 (this commit) | (this file) |
| 00-product-tag-schema.txt | paused mech.3 | ProductTag schema, confirms `confidence` field |
| 01-bulk-approve-dry-run.txt | paused mech.3 | dry-run WITHOUT confidence filter (404 candidates) |
| _inspect-confidence.ts | paused mech.3 | one-shot inspection script (kept as evidence) |
| _confidence-inspection.txt | paused mech.3 | distribution: 404 candidates, 22.8% sub-0.8 |
| 02-bulk-approve-dry-run-confident.txt | mech.3 (this commit) | dry-run WITH `--min-confidence=0.8` (312 candidates) |
| 03-bulk-approve-live.txt | mech.3 (this commit) | wave 1: 50/312 flipped, P1017 drop, exit 1 |
| _inspect-partial-state.ts | mech.3 (this commit) | one-shot partial-state inspection script |
| 03a-partial-state-inspection.txt | mech.3 (this commit) | partial state: 50 audited, 262 high-conf PENDING remaining |
| 03b-bulk-approve-live-resumed.txt | mech.3 (this commit) | wave 2: 262/262 flipped, clean AFTER snapshot |
| _post-pass-snapshot.ts | mech.3 (this commit) | one-shot post-pass snapshot script |
| 04-post-pass-axis-coverage.txt | mech.3 (this commit) | standalone per-axis APPROVED counts post-pass |
| _axis-coverage-snapshot.ts | mech.3.5 | one-shot per-axis coverage probe (all 9 axes) |
| 05-probe-stage-1-post-mech-3.json | mech.3.5 | Stage 1 regression check post-mech.3 |
| 05-axis-coverage-post-mech-3.txt | mech.3.5 | per-axis APPROVED + PENDING + REJECTED across all 9 axes |
| 06-eval-post-mech-3.txt | mech.3.5 | eval CLI re-run post-mech.3 (aggregateScore 0.3333) |
| 07-mech-3-verification-analysis.md | mech.3.5 | distribution-shift analysis + per-fixture trajectory |

The underscore-prefixed files (`_inspect-confidence.ts`,
`_confidence-inspection.txt`) flag themselves as one-shot evidentiary
tools. They are NOT reusable across sub-bundles. mech.3.5 and beyond
will not invoke them; the inspection script's purpose was to surface
the gate finding and its evidence, both of which are now captured.
