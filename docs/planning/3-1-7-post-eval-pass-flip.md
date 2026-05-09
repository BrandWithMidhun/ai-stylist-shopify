# Sub-bundle 3.1.7 — Stage 1 universe correction (post-eval-pass flip prerequisites)

**Status:** PLANNING (architecture locked, mechs not yet implementing).
**Investigation threads:** 1, 2, 3 — three read-only threads complete, all artifacts in `.pr-3-1-7-planning-artifacts/`.
**Prior context:** Sub-bundle 3.1.6 closed at `e48e079` (recurring-sync wire shipped, α backfill executed, 3 trigger paths verified end-to-end).
**Closes on:** the universe-collapse and variant-loading gaps blocking the post-eval-pass v1→v2 flip. Op debt #11 (OOS-substitute deferral) and #15 (v2 ProductCard variant-loading) close in mech.1+mech.2 here. The flip itself is deferred to Sub-bundle 3.1.8.

---

## Section 1 — Problem statement

The 3.1.6 close framed 3.1.7 as "post-eval-pass flip = registry edit + variant-loading on v2 ProductCard." Three read-only investigation threads invalidated that framing.

**Thread 1 (registry surface + flip-site verification):** the "registry" referenced in op debt #15 is `app/lib/chat/tools/registry.server.ts`, not a recommendations-package registry. There is no `app/lib/recommendations/v1/` directory; "v1" is the legacy chat tool stub `recommend-products.server.ts`, "v2" is the unregistered `recommend-products-v2.server.ts` that calls the multi-stage `runPipeline`. The flip site is ~3 logical edits / ~8 lines in registry.server.ts. v1↔v2 surface parity is clean (same tool name, same input schema, signature-compatible return). One direct importer (`app/lib/chat/agent.server.ts:29`) and one user-visible route (`app/routes/api.chat.message.tsx:97`). Eval bypasses the registry entirely (calls `runPipeline` directly via `RealPipelineRunner`). Variant-loading is genuinely unwired — `stage-6-output.server.ts:166-167` hardcodes `variantId: null` and `available: true`, the orchestrator passes those placeholders through unchanged, and the chat widget at `chat-widget.js:839,898` treats them as OOS, hiding Add-to-Cart on every recommended product.

**Thread 2 (Stage 1 behaviour under sparse APPROVED tags):** the dominant Stage 1 bottleneck is NOT APPROVED-tag coverage. It is the structural variant filter `EXISTS variant WHERE availableForSale=true` on every Stage 1 query. The 3.1.6 close attributed eval invariance to tag coverage; Thread 2's probe (`probe-stage-1.ts` against the dev-shop production DB at 2026-05-09T08:05Z) shows the structural Stage 1 universe is **29 of 1,169 ACTIVE+embedded products**. 1,140 ACTIVE products have no `availableForSale=true` variant. Even bulk-approving every tag axis to 100% wouldn't unlock more than 29 candidates. The triple-invariance datapoint (mech.6 baseline → 3.1.5 post-bulk-reembed → 3.1.6 post-α, all `aggregateScore=0.0833`) decomposes into two compounding gaps: (a) Stage 1 universe (29) ∩ APPROVED-`category=<extracted-value>` = 1 product (the trousers fixture's lone candidate), and (b) catalog-wide APPROVED coverage on every secondary axis (`occasion`, `color_family`, `material`, `fit`, `season`, `size_range`, `style_type`) is **0%**. The single PASS is mathematically degenerate: 1 candidate × 1 satisfying = relaxed=1.0; with `expectedHandles` empty, combinedScore = 1.0 × relaxed = 1.0; aggregateScore = 1.0 / 12 = 0.0833. R3 = 0.0833 was set TO the empirical baseline, so as a "don't regress" floor it is tautological; nothing has ever been at risk of regressing below.

**Thread 3 (option-pick synthesis):** four additional premise corrections.

1. Op debt #11's resolution path ("Phase 5 full-catalog tagging will resolve OOS-stress fixtures naturally") is invalid. The shirt fixture has 26 catalog-wide APPROVED `category=shirt` products; 0 of them are in the 29-universe. Tagging more products on the same 1,140-product unbuyable subset wouldn't help. The blocker is variant availability, not tag coverage.
2. Mech.5 D6's "Stage 1 EXISTS pre-filter handles steady state; the rare mid-pipeline-flip case is unaddressed" was wrong from the start. What was thought to be the rare edge case (variant availability changing mid-pipeline) is not the issue; the issue is the steady-state filter itself eliminates 97.5% of the catalog. The OOS-substitute architecture isn't an edge-case feature; it's a structural requirement.
3. There is no standalone decision register. D-numbered locked decisions live in per-mech source-file headers (`pipeline.server.ts`, `stage-N-*.ts`) and the numbering RESTARTS per mech. `pipeline.server.ts D7` (RecommendationEvent writes in tool stub) is a different decision from `stage-6-output.server.ts D7` (finalScore formula) which is different from `stage-3-rerank/query-extraction.server.ts D7` (synonym dict cap). Citations need both file path AND mech context.
4. R3 is informational, not load-bearing — confirmed by Thread 2 and re-confirmed by Thread 3.

The original "ship the flip" question is therefore not the right question for 3.1.7. The right question is: **what makes the flip worth shipping in 3.1.8?**

---

## Section 2 — Architectural decision

### Locked: Option C-folded

3.1.7 ships the universe-correction sub-bundle. The flip mech itself moves to 3.1.8.

- **mech.1: Variant-filter relocation to Stage 6.** Remove the `availableForSale=true EXISTS` predicate from Stage 1's hard-filter SQL. Add binary `available: <real value>` attachment in `stage-6-output.server.ts` (replacing the current `available: true` stub). Stage 1's structural universe expands from 29 → 1,169 ACTIVE+embedded products.
- **mech.2: Variant-loading wire (op debt #15 closure).** Resolve Stage 6's hardcoded `variantId: null` and `compareAtPrice: null` stubs by attaching real variant data on the top-N. Decision-A at mech.2 prompt time: source variant data from (preferred) the existing Stage 1 product fetch payload, or a dedicated variant-load step in Stage 6 if Stage 1's fetch shape doesn't carry it. v2 ProductCard surface parity is clean per Thread 1; verify in mech.
- **mech.3: Bulk-approve secondary axes.** Re-invoke `scripts/bulk-approve-tags.ts` with `--axes=occasion,color_family,material,fit,season,size_range,style_type` against `ai-fashion-store.myshopify.com`. Lifts each secondary axis from 0% to >50% APPROVED across the 50-product calibration sample.
- **mech.4 (conditional): Vocabulary expansion (`category=saree`, `category=shorts`).** Currently 0 APPROVED catalog-wide. Conditional on mech.1-3 verification revealing these are still blockers post-universe-expansion. If post-mech.3 the saree/shorts fixtures unblock via secondary-axis matches, mech.4 is cut from scope.
- **mech.5: Retire R3 = 0.0833, re-anchor eval baseline.** Capture a non-degenerate baseline against the post-mech.1-3(-4) state. R3 was tautological from inception; replacing it with an empirical anchor restores the floor concept's information content.

### Why this and not Options A, B.i, B.ii-bundled-with-flip, D-alone, or E-alone

- **Option A (flip-as-is in 3.1.7):** ships v2 against a 29-product universe with broken variant-loading. Per the per-fixture eval prediction grid in artifact `23`, aggregateScore stays at 0.0833 ± regression risk (v2's pipeline might not return the same single-trouser candidate v1 returns). Every recommendation in the chat widget displays as OOS because variantId is null. Functional regression vs the current v1 chat tool. Sets precedent of "ship known-broken to clear a milestone" — the project pattern has consistently chosen against this.
- **Option B.i (soften Stage 1 hard-filter on empty result):** doesn't address the dominant bottleneck. The variant filter applies BEFORE the per-axis hard-filter would relax. Per-fixture grid: aggregateScore stays at 0.0833. Tactical patch with no diagnostic value; introduces a "soft-when-convenient" code path that confuses Stage 1's contract for future readers.
- **Option B.ii-bundled-with-flip:** B.ii (variant-filter relocation) is the right work. Bundling it with the v1→v2 flip in a single sub-bundle ties the flip's eval delta to a multi-mech architectural change and makes the eval delta un-attributable to either alone. Diagnostic separability is exactly what 3.1.6's per-mech verification pattern (mech.N + mech.N.5) protects.
- **Option D alone (bulk-approve secondary axes only):** universe stays at 29, eval stays at 0.0833. The 50-product calibration sample overlaps the 29-universe at ~1 product (the trousers); bulk-approving its remaining axes only lifts that single product's per-axis APPROVED coverage. Insufficient to move the eval needle.
- **Option E alone (vocabulary expansion only):** at most 2 fixtures move (saree, shorts), and only if those products land in the 29-universe — which requires mech.1 first. E-alone is a no-op; E folded into 3.1.7 (as conditional mech.4) is fine.

### Why mech.1 targets Stage 6 binary include/exclude, not Stage 3 rerank weighting

Five-point rationale, in order of weight:

1. **Diagnostic separability.** Binary keeps availability as a single signal. Rerank weighting compounds availability with semantic similarity, recency, and merchant signals — making downstream debugging multi-signal.
2. **Chat widget symmetry.** Widget already implements a binary OOS check at `chat-widget.js:839,898`. Stage 6 binary plugs directly in. Stage 3 weighting would require new widget logic to decide display-vs-hide-vs-disable for probabilistically-ranked OOS items.
3. **Op debt #11 clean resolution.** OOS-substitute behavior, if wanted, lives in a future upstream substitute-retrieval stage — not as a rerank side-effect. Binary exclude resolves #11 cleanly; weighting half-resolves it.
4. **Reversibility.** Binary→weighted is a one-line change. Weighted→binary requires re-tuning every surface that learned to expect probabilistic ranking.
5. **Decision-audit alignment.** Mech.5 D6 (Stage 1 EXISTS pre-filter) was trying to express availability-as-hard-fact in the wrong location. Stage 6 binary relocates the spirit; Stage 3 weighting inverts it.

Counter-argument acknowledged: multi-merchant OOS policy diversification (some merchants want OOS-with-substitutes shown) is more naturally expressed as weighting. Captured as op debt #42 — revisit at Phase 5+.

### Trade-offs accepted

- **3.1.7 ships no user-visible change.** The flip is the user-visible event; deferring it means storefront chat behavior is unchanged at end-of-3.1.7. The compensation is that 3.1.8's flip ships against a non-degenerate eval baseline with op debts #11 and #15 already closed.
- **Eval re-baseline midstream invalidates the R3=0.0833 anchor.** Future sub-bundles measuring against the new baseline cannot directly compare to pre-3.1.7 numbers. Acceptable because the pre-3.1.7 anchor was tautological anyway.
- **Mech.1 reopens the locked design choice in mech.5 D6** (Stage 1 EXISTS pre-filter). Reopening is justified by Threads 2 + 3 finding the locked premise was empirically wrong. Decision-audit cadence (op debt #40) is the durable lesson.
- **Bulk-approve in mech.3 reuses the mech.6-baseline-prep concession** (auto-APPROVE of AI-tagged PENDING_REVIEW rows without per-product merchant review). The original concession was a one-shot pre-launch prep; mech.3 reuses it for the same dev shop in the same Phase 1 / Phase 2 window. Phase 4 portal eventually replaces this with merchant-reviewed approval; until then, bulk-approve is the canonical interim path (per HANDOFF op debt #8).

---

## Section 3 — Mech-commit shape

### PR-3.1.7-mech.1 — Variant-filter relocation to Stage 6 (~120 LOC, 3-5 test updates/additions)

- Remove `availableForSale=true EXISTS` predicate from `stage-1-hard-filters.server.ts` query construction (lines 86-89 of the current file).
- Add binary `available: <real value>` attachment in `stage-6-output.server.ts:138-173` (`formatProductCard` — replace the `available: true` stub at line 167).
- Stage 1 unit tests: update the "EXISTS check on ProductVariant.availableForSale" test (currently asserts predicate IS present; should assert IS NOT present post-relocation). Three other Stage 1 tests are unaffected (they assert other invariants).
- Stage 6 unit tests: add binary attachment test covering both `available=true` (variant has stock) and `available=false` (no available variant) cases.
- Open at mech.1 prompt time: whether the available-variant fetch happens (a) inside Stage 1's existing product query (LEFT JOIN ProductVariant + aggregate boolean) or (b) as a dedicated Stage 6 mini-query for top-N. Lean (a) — single-roundtrip stays consistent with Stage 1's existing posture, and mech.2 will need the variant data anyway. Confirm at mech.1 prompt time against the actual query shape.

### PR-3.1.7-mech.1.5 — Verification artifact (~30 LOC probe, no source edits)

- Re-run Thread 2's `probe-stage-1.ts` against post-mech.1 state. Capture `.pr-3-1-7-mech-1-artifacts/per-fixture-stage1.json`.
- Expected: stage1UniverseStructural ~29 → ~1,169. Per-fixture candidate counts move from EMPTY/SPARSE/NO-HARD-FILTER buckets toward HEALTHY for the category-extracting fixtures.
- Interim eval capture at this point isolates universe-expansion's eval impact from mech.2's variant-loading impact. Mirrors 3.1.6's mech.N.5 pattern.

### PR-3.1.7-mech.2 — Variant-loading wire (op debt #15 closure) (~80 LOC, 2-3 new tests)

- Resolve `stage-6-output.server.ts:166` `variantId: null` and `:158` `compareAtPrice: null` stubs by attaching real variant data on the top-N.
- Implementation lock at mech.2 prompt time: variant data sourced from (a) Stage 1's product fetch payload (preferred — single roundtrip, consistent with mech.1's choice), or (b) a dedicated variant-load step in Stage 6 (fallback if Stage 1 doesn't carry it).
- v2 ProductCard surface parity per Thread 1 artifact `04`/`05`: legacy `formatProductCard` populates `variantId` from `extractNumericId(variant.shopifyId)`; v2 should mirror this. Storefront `/cart/add.js` expects numeric variant ID.
- Closes op debt #15. Closes the adjacent gap noted in Thread 1 artifact `06` (`compareAtPrice` hardcoded null in v2 — same load-shape, fix together).

### PR-3.1.7-mech.2.5 — Verification artifact (~30 LOC, no source edits)

- Probe-driven: invoke v2 tool stub directly on a representative fixture intent, dump returned `ProductCard[]`, assert each card has populated `variantId` (numeric string) and accurate `available` boolean.
- Dev-shop-driven: smoke test via the chat widget — manually issue 2-3 chat queries against the dev shop's `web-production-3b1d7.up.railway.app` deployment, confirm Add-to-Cart appears on returned product cards.
- Capture artifacts to `.pr-3-1-7-mech-2-artifacts/`.

### PR-3.1.7-mech.3 — Bulk-approve secondary axes (~30 LOC of script-invocation, no script changes)

- Invoke the existing `scripts/bulk-approve-tags.ts` (no script edits — the script is parameterized) with `--axes=occasion,color_family,material,fit,season,size_range,style_type` and `--shop=ai-fashion-store.myshopify.com`.
- The script's existing `--dry-run` + per-axis count snapshot establishes the BEFORE state; the real run captures AFTER counts via the same shape.
- Audit trail via the script's existing `ProductTagAudit` writes (action="APPROVE", actorId="system://3.1.7/mech.3").
- Verification (mech.3.5 below) does the eval re-baseline.

### PR-3.1.7-mech.3.5 — Verification artifact (~30 LOC probe + eval rerun, no source edits)

- Re-invoke Thread 2's catalog-coverage scan portion of `probe-stage-1.ts` (or a slimmer probe-tag-coverage script if that's cleaner). Capture `.pr-3-1-7-mech-3-artifacts/post-approve-axis-coverage.json`. Expect each of the 7 axes to move from 0% → >50% APPROVED on the calibration sample.
- Re-run `npx tsx scripts/run-eval.ts --all` and capture `.pr-3-1-7-mech-3-artifacts/post-mech-3-eval-baseline.txt`. Expected aggregateScore in the 0.30–0.50 range per Thread 3 artifact `23` per-fixture eval prediction grid (only universe + secondary-axis, not vocabulary).
- This is the first non-degenerate eval baseline. Use it as the input to mech.4's conditional decision and mech.5's anchor.

### PR-3.1.7-mech.4 (conditional) — Vocabulary expansion (~30 LOC, ~2-4 manual approvals)

- Pre-decision: Re-run probe-stage-1.ts on the saree/shorts fixtures (`fashion-oos-stress-2`, `fashion-summer-shorts-size-m`). If they're now PARTIAL/PASS post-mech.3, **mech.4 is CUT from scope**.
- If still EMPTY/FAIL (per current Thread 2 data they likely will be — saree=0 and shorts=0 catalog APPROVED at HEAD): identify catalog products that *should* have category=saree or category=shorts (Prisma Studio inspection). Use bulk-approve helper or one-shot SQL UPDATE to manually flip those rows to APPROVED.
- This is the smallest mech in scope and the only one with a "skip if not needed" gate.

### PR-3.1.7-mech.5 — Retire R3, re-anchor eval baseline, and HANDOFF amendment

- Capture a final eval baseline against the cumulative post-mech.1-3(-4) state. This is the new anchor.
- Document the new baseline in HANDOFF.md as a fresh anchor with derivation explicit (e.g., "post-3.1.7 baseline = 0.X across 12 fixtures, derived against universe-corrected catalog with secondary-axis APPROVED on the 50-product calibration sample").
- Retire R3=0.0833 explicitly. Replace with a re-anchored quality ladder tied to fixture pass-rate (suggested: R3.0 = post-3.1.7 actual; R3.1 [3.1.8 flip target] = R3.0 with no regression; R3.2 [Phase 5 multi-mode] = ≥ 0.50). Confirm exact ladder at mech.5 prompt time.
- HANDOFF amendment with op debt items #38-#42 (this planning round's contribution), close subsection format mirroring 3.1.6 close.
- Verification (mech.5.5 inline): the new baseline is recorded, re-runnable, and reproducible from the eval harness output.

**Total: 4 mechs + 1 conditional mech + close (mech.5).** Three mech.N.5 verification artifacts (mech.1.5, mech.2.5, mech.3.5). Slightly larger than 3.1.6's "3 mechs + close" split because the universe correction touches both Stage 1 and Stage 6, and the eval re-anchoring adds a mech of its own.

---

## Section 4 — Mech sequencing rationale

- **mech.1 first** — every other mech's verification depends on whether the universe is 29 or 1,169.
- **mech.2 second** — the variant-loading wire site is *defined by* mech.1's choice (Stage 6 binary attachment); the load shape can't be locked until mech.1 design is fixed.
- **mech.3 third** — independent in principle but bulk-approval impact is only observable post-universe-correction; running it earlier wastes the verification eval-rerun on a still-29-product universe that won't show the per-axis approval impact.
- **mech.4 conditional** — gated on mech.1-3 verification per the explicit decision gate above.
- **mech.5 last** — re-anchoring requires the non-degenerate baseline to exist.

Interim eval capture between mech.1 and mech.2 (as mech.1.5 verification artifact, not a separate mech): isolates universe-expansion's eval impact from variant-loading's. Mirrors 3.1.6's mech.N.5 pattern.

Production verification deferred to 3.1.8 (the actual flip mech). 3.1.7 ships entirely against dev shop + eval harness + unit tests. The chat widget smoke test in mech.2.5 exercises the production deployment but does NOT flip the agent — it's invoking the v2 tool stub directly to verify ProductCard shape, not changing what the agent calls.

---

## Section 5 — Implementation details locked at planning time

| Decision | Locked answer | Source |
|---|---|---|
| **Architecture** | Option C-folded: 3.1.7 ships universe correction; 3.1.8 ships the flip | Thread 3 §3 |
| **Variant filter location** | Stage 6 binary include/exclude (NOT Stage 3 rerank weighting) | Thread 3 §2.5-rationale |
| **Variant-loading authority** | v2 tool stub (or Stage 6 — same shape; preferred per mech.6 D7 "orchestrator pure-compute" principle, mirrors legacy `recommend-products.server.ts:135-164` formatProductCard pattern) | Thread 3 artifact 24 |
| **Variant-loading shipping order** | Ships in 3.1.7 mech.2 alongside universe correction, NOT as a 3.1.8 precursor | Thread 3 §3 |
| **Op debt #15 closure** | mech.2 closes #15 architecturally | Thread 3 artifact 20 |
| **Op debt #11 closure** | mech.1 closes #11 architecturally (relocates the OOS-handling concern to Stage 6 binary attachment; OOS-substitute mech that #11 deferred is no longer needed because Stage 6 just doesn't surface OOS items in the first place) | Thread 3 §6 |
| **Bulk-approve target axes** | occasion, color_family, material, fit, season, size_range, style_type (7 axes — every secondary axis the 12 fixtures collectively query that has 0% catalog APPROVED today) | Thread 2 artifact 16 |
| **R3=0.0833 disposition** | Retire and re-anchor (mech.5). Not numerically revised. | Thread 2 artifact 17, Thread 3 §5.c |
| **Flip mech itself** | Deferred to Sub-bundle 3.1.8 (3.1.8-mech.1) | Thread 3 §3 |

---

## Section 6 — Implementation details deferred to mech-prompt time

These are decisions that are too small for the planning round to lock but big enough to call out so the mech prompts don't drift:

1. **Whether mech.1 fetches variant data inside Stage 1's existing product query (single-roundtrip LEFT JOIN + aggregate boolean) or as a dedicated Stage 6 mini-query.** Lean single-roundtrip — Stage 1 is already the per-shop query and mech.2 will need the variant data anyway. Confirm at mech.1 prompt time against Stage 1's actual fetch shape.
2. **Whether mech.1 drops the variant filter entirely or replaces it with a softer signal (e.g., `has_any_variant: boolean` predicate that doesn't require `availableForSale=true`).** The locked answer above says "remove" — but if Stage 1 should still gate "products that have variants at all" (vs draft products with zero variant rows), the softer signal is closer to right. Mech.1 prompt picks; default is full removal.
3. **Mech.2's `compareAtPrice` policy when variant has no compareAtPrice or compareAtPrice ≤ price.** Legacy `recommend-products.server.ts:144-148` returns `null` in those cases. Mirror the legacy posture. Lock at mech.2 prompt time if it's not just a copy-paste.
4. **Mech.3's bulk-approve actor-id convention.** 3.1.6 used `system://3.1/mech.6/baseline-prep`. Follow the same naming pattern: `system://3.1.7/mech.3/secondary-axis-bulk-approve` (or similar — finalize at mech.3 prompt time).
5. **Mech.4 catalog-search heuristic for saree/shorts.** If mech.4 fires (i.e., the conditional gate doesn't cut it from scope), the actual product identification (which catalog products *should* have category=saree or category=shorts) is a Prisma Studio + manual inspection step. Mech.4 prompt enumerates the candidates (or surfaces that the catalog truly has zero saree/shorts and escalates).
6. **Mech.5's R3 ladder shape.** Suggested R3.0 / R3.1 / R3.2 ladder — but the actual numbers depend on the empirical mech.3.5 eval baseline. Mech.5 prompt locks them against the observed value.

---

## Section 7 — Out-of-scope (deferred)

Explicitly NOT in 3.1.7:

- **The actual v1→v2 flip.** Moves to Sub-bundle 3.1.8 (3.1.8-mech.1). The chat-tools registry edit is one place, ~3 logical edits per Thread 1 artifact `02`.
- **Legacy `recommend-products.server.ts` deletion.** Defer to 3.1.8-mech.2 (or later cleanup commit), after the flip ships and is verified.
- **Phase 5 multi-mode rerankers** (ELECTRONICS, FURNITURE, BEAUTY, JEWELLERY, GENERAL hard-filter axes). Per HANDOFF, follows Sub-bundle 3.2.
- **`expectedHandles` curation in eval fixtures** (op debt #9). Pre-3.2 Midhun task. Eval scoring will continue using relaxed-match-only until handles are curated. Mech.5's re-anchor honestly reflects this — the new baseline is a relaxed-only baseline.
- **Catalog-side variant inventory hygiene** (the underlying cause of the 1,140 unbuyable products). 3.1.7-mech.1 makes the recommendation engine robust to the gap; it does NOT fix the catalog data. Phase 5 onboarding work or a separate catalog-hygiene sub-bundle picks this up.
- **Order ingest + sales velocity + AttributionEvent** (Sub-bundle 3.2). Per HANDOFF, follows 3.1.8.
- **Stage 1 PENDING_REVIEW soften** (option B.iii from Thread 2 synthesis). Crosses the locked APPROVED-only design line in `stage-1-hard-filters.server.ts:25-28`. Out of 3.1.7 scope.
- **Storefront API render-time availability check** (artifact 24 Answer 3 — chat widget calls Storefront API per recommendation render). Most decoupled architectural answer, network-heavy. Documented for completeness; not a 3.1.7 option.
- **Standalone decision register** (op debt #41). Documentation gap surfaced by Thread 3 but creating a register mid-project is its own scope. Captured as low-priority backlog.

---

## Section 8 — Op debt items added during this planning round

Append items #38 through #42 to the existing flat numbered list in HANDOFF.md (do NOT renumber the existing 1-37). Items 38-42 are this planning round's contribution; items surfaced during mech execution will be appended at the 3.1.7 close subsection.

```
38. Eval-bottleneck framing in 3.1.6 close attributed bottleneck to APPROVED-tag coverage; Thread 2 of 3.1.7 found variant-filter dominance (29 of 1,169 universe). Future eval-bottleneck claims must diagnose Stage 1 universe size BEFORE attributing to tag coverage. Probe pattern: count distinct products surviving Stage 1's structural filters separately from the per-axis tag predicate.
39. Op debt #11's "Phase 5 catalog tagging will resolve OOS-stress fixtures" framing is invalid. Phase 5 tagging on the 1,140 unbuyable products would not move eval. Resolution path is universe correction (3.1.7-mech.1), not tagging coverage. Closes #11 as architecturally invalid; supersedes with this finding.
40. Mech.5 D6 ("Stage 1 EXISTS pre-filter handles steady state") was wrong from the start — the steady state IS the problem. Locked decisions warrant periodic re-audit when downstream evidence contradicts the locking premise. Consider a lightweight decision-audit pass at sub-bundle planning rounds (per the new "premise verification" item #33 — D-numbered decisions are no exception).
41. No standalone decision register exists; D-numbers restart per mech and are scattered across mech prompts and source-file headers. Future planning rounds would benefit from a unified register, but creating one mid-project is its own scope. Capture as low-priority backlog. Until a register lands, D-decision citations must include both mech AND file path to disambiguate (e.g., "pipeline.server.ts D7 mech.6" not just "D7").
42. Multi-merchant OOS policy diversification (some merchants may want OOS-with-substitutes shown, others want strict exclude) is more naturally expressed as Stage 3 weighting than Stage 6 binary include/exclude. Revisit Stage 6-vs-Stage 3 placement at Phase 5+ when multi-merchant tuning enters scope. Until then, Stage 6 binary is the locked choice (3.1.7-mech.1) for diagnostic separability + chat widget symmetry + reversibility (binary→weighted is one-line; weighted→binary is multi-surface).
```

---

## Section 9 — References

- Investigation artifacts (this planning round, `.pr-3-1-7-planning-artifacts/`):
  - **Thread 1 (registry surface + flip-site verification, 8 artifacts):**
    - `01-registry-server-ts-verbatim.txt` — chat-tools registry verbatim + path correction
    - `02-flip-site-context.txt` — exact edits, line-numbered, with surrounding context
    - `03-registry-consumers.txt` — single direct importer (agent.server.ts), single user-visible route
    - `04-v1-public-surface.txt` — legacy tool stub exports + return shape
    - `05-v2-public-surface.txt` — v2 tool stub exports + parity assessment + variantId/available gap
    - `06-productcard-references.txt` — two ProductCard types, chat widget OOS check, gap detail
    - `07-op-debt-15-verbatim.txt` — first capture of #15 (re-pulled in artifact `20` for fresh-eyes confirmation)
    - `08-thread-1-synthesis.md` — flip is one-place + ~3 edits + medium mech (1.5–2 sub-mechs with #15 closure)
  - **Thread 2 (Stage 1 behaviour under sparse APPROVED tags, 10 artifacts + 1 probe script):**
    - `09-stage-1-implementation.txt` — Stage 1 SQL builder verbatim + 6 structural filter observations
    - `10-stage-1-tests.txt` — Stage 1 vitest mocks the SQL string; zero behavioral coverage
    - `11-eval-directory-listing.txt` — eval architecture data flow diagram
    - `12-eval-fixtures-verbatim.txt` — all 12 eval fixtures verbatim (note: every fixture has empty expectedHandles)
    - `13-eval-entry-points.txt` — `npx tsx scripts/run-eval.ts --all` invocation, side effects, output shape
    - `14-stage-1-per-fixture-output.json` — load-bearing probe output: 29-universe finding, per-fixture Stage 1 candidate counts, per-axis APPROVED catalog coverage
    - `15-stage-1-failure-mode-per-fixture.md` — per-fixture EMPTY/SPARSE/HEALTHY/NO-HARD-FILTER bucketing + failing axis attribution
    - `16-axis-coverage-scan.json` — curated axis-coverage subset of `14` for Thread 3 consumption
    - `17-r3-threshold-references.txt` — R3 location, semantics, evaluation history; demonstrates R3 = empirical baseline
    - `18-thread-2-synthesis.md` — variant filter is THE bottleneck; secondary-axis APPROVED is 0%; aggregateScore is degenerate
    - `probe-stage-1.ts` — read-only probe (used Stage 1 + extractQueryAttributes from production source; no DB writes; no Voyage call)
  - **Thread 3 (option-pick synthesis, 8 artifacts):**
    - `19-op-debt-11-verbatim.txt` — re-pull of #11 + Thread 3's premise-correction reading
    - `20-op-debt-15-verbatim.txt` — re-pull of #15 + cross-thread interaction analysis
    - `21-decision-register-locations.txt` — there is no register; D-numbers per mech in source file headers
    - `22-relevant-locked-decisions.txt` — 7 locked decisions Thread 3's option-pick interacts with, verbatim
    - `23-option-comparison.md` — 6-option comparison table + per-fixture eval prediction grid
    - `24-availability-authority-analysis.md` — three coherent answers to "where does availability live?", recommends Answer 2
    - `25-test-strategy-per-option.md` — per-option test path mapping (eval / probe / dev-shop / production / none)
    - `26-thread-3-synthesis.md` — recommends Option C-folded, mech decomposition, decision-points-resolved, op debts #38-#42
- Empirical proof points:
  - Stage 1 universe = 29 (artifact `14` `catalog.stage1UniverseStructural`)
  - 0% APPROVED on every secondary axis (artifact `14` `distinctProductsWithApprovedTagPerAxis`)
  - Triple eval-invariance at 0.0833 (HANDOFF lines 417, 490, 645 — three EvalRun rows across mech.6 baseline, 3.1.5 post-bulk, 3.1.6 post-α)
- Prior closure commits: `8bf9da8` (Sub-bundle 3.1 close), `3cdf212` (Sub-bundle 3.1.5 close), `e48e079` (Sub-bundle 3.1.6 close).
- Anchor source files referenced throughout:
  - `app/lib/chat/tools/registry.server.ts` — flip site (3.1.8-mech.1)
  - `app/lib/chat/tools/recommend-products.server.ts` — legacy v1 tool, deletion candidate post-flip
  - `app/lib/chat/tools/recommend-products-v2.server.ts` — v2 tool stub, mech.2 wire site
  - `app/lib/recommendations/v2/stage-1-hard-filters.server.ts` — mech.1 modifies (variant-filter relocation)
  - `app/lib/recommendations/v2/stage-6-output.server.ts` — mech.1 + mech.2 modify (binary `available` attachment + variant-load)
  - `app/lib/recommendations/v2/pipeline.server.ts` — orchestrator (no source change in 3.1.7; signature pass-through only)
  - `extensions/storefront-widget/assets/chat-widget.js:839,898` — widget OOS check; mech.2 verification target
  - `scripts/bulk-approve-tags.ts` — mech.3 invokes (no source changes; configuration only)
  - `scripts/run-eval.ts` + `app/lib/recommendations/v2/eval/` — mech.1.5, mech.3.5, mech.5 verification harness
