# Artifact 17 — Fix (c) policy-document analysis

**Fix (c) (from HANDOFF amendment line 819):**
> "Proportional coverage discipline: treat secondary-axis coverage as a *prerequisite* for category coverage expansion. mech.4's lesson: don't add 200 kurta rows without also adding fit tags to those 200 products."

## 1. Enforceability — where could this discipline live?

The candidate enforcement surfaces, ordered roughly weakest → strongest:

### Option C-α: Planning-round discipline (humans-reviewing-humans)
The 3.1.7 planning round and the mech-prompt structure already gate work behind decision-gates. Fix (c) at the planning level means future planning rounds that propose catalog-expansion work (rule-engine seeds, bulk-approve runs, AI-tagger re-runs) must include a per-axis-coverage matrix and a verification gate.

Concretely: the mech.4 planning would have required a section "What happens to fit / occasion / color / season coverage if mech.4 lands 200 kurta rows?" The verification gate would reject mech.4 if the coverage matrix showed fit going from 39 → 39 distinct products (no proportional growth).

**Enforcement cost:** zero code; one process change. Free in tools, expensive in human-attention discipline. Single biggest risk: a future planning round under time pressure skips the check.

### Option C-β: HANDOFF op-debt list as policy registry
Codify the discipline as a process item in HANDOFF.md (similar to op debt #40 "decision-audit cadence at sub-bundle planning rounds"). Every catalog-expansion mech writes a section "Coverage matrix delta" in its commit message, showing before/after per-axis APPROVED distinct products. The 3.1.8 mech.4-style retrospective then becomes a checklist item.

**Enforcement cost:** marginal — a paragraph in HANDOFF + a 5-line checklist in mech-prompt template.

### Option C-γ: Pre-commit hook on `scripts/apply-rules-to-shop.ts` and `scripts/bulk-approve-tags.ts`
The scripts that perform catalog-expansion (rule-engine application, bulk-approve) could refuse to run without a `--coverage-matrix-snapshot` flag that requires the user to print and confirm the per-axis coverage state. Defensive guardrail.

**Enforcement cost:** ~30 LOC + 1-2 tests per script. Adds friction. Could be bypassed by running raw SQL — but raw SQL is the unsafe path anyway.

### Option C-δ: Phase 5 portal-UI check
When the merchant portal lands (Phase 5+), the catalog-tagging workflow can surface the per-axis coverage delta as part of every approval. "You are about to approve 200 category=kurta rows. Current fit coverage is 39 of 1,169 products (3.3%). Proportional fit coverage on the kurta set would require approximately 7 fit tags on these 200 products. Continue anyway?" Lets the merchant make the trade-off explicit.

**Enforcement cost:** Phase 5+ portal feature. Not 3.1.8 scope.

### Option C-ε: Rule-engine gate at apply time
Modify `scripts/apply-rules-to-shop.ts` to check whether the rule's effect would push a category's per-axis-coverage ratio below a threshold (e.g., "if applying this rule would result in less than 5% of the affected products having APPROVED `fit`, refuse and exit with a coverage warning"). The threshold itself is a parameter.

**Enforcement cost:** ~50 LOC + comprehensive tests. Most intrusive guardrail.

### Recommendation among C-α through C-ε

For 3.1.8: **C-α + C-β**. Planning-round discipline + HANDOFF op-debt list entry. Lightweight, doesn't add code, captures the lesson where future planning rounds will see it.

For 3.2+: **C-γ** (pre-commit hook on apply-rules + bulk-approve). The dev-shop catalog is going to keep changing as more shops onboard; a guardrail at the scripts themselves prevents the same regression pattern from sneaking in. Lock specifics at 3.2 planning round.

For Phase 5+: **C-δ** (portal-UI check). Once merchants are doing their own tagging, the portal must surface coverage state.

C-ε is overengineered for 3.1.8 — it requires deciding the threshold (5%? 10%?) ahead of the empirical work that would tell us the right threshold.

## 2. Cost — long-term throughput impact

Fix (c)'s real cost is throughput: every catalog-expansion mech now has a coverage matrix gate. The mech.4 retroactive kurta-rule activation, if held to fix (c), would have required:
- Identifying the 200 catalog products that would become category=kurta.
- Adding fit tags (AI-tagger or manual) on ~5-10% of them (proportional to current fit coverage of 39/1,169 = 3.3% baseline).
- Verification that the new fit tags pass quality review.
- Eval re-run to confirm coverage delta doesn't regress.

In the 3.1.7 sub-bundle, mech.4 took roughly 1 verification commit (mech.4.5). With fix (c) it would have taken 2-3 commits: a fit-tag-augmentation mech + verification + the rule-engine pass + verification.

**Throughput cost: ~2x for catalog-expansion mechs.** Over 3.2-Phase 4, where many catalog-expansion mechs land (more shops onboarding, more rule seeds, AI-tagger re-runs as embedding models improve), the cumulative cost is significant. Estimate 5-10 extra mech.N.5 verification commits across 3.2-Phase 4.

The benefit: zero recurrence of mech.4-style regressions, where broader category coverage HURT eval. Each prevented regression saves a debug cycle + restores eval confidence + avoids the cumulative-vs-final-mech attribution complexity.

Net economic call: positive over 3.2-Phase 4 horizon. Negative if shipping pressure forces planning rounds to skip the check.

## 3. Robustness — does (c) actually solve the ranking gap?

**Critical observation: (c) does NOT recover the existing kurta regression.** The 200 RULE-tagged kurta rows are already in the catalog; mech.4 already shipped. Fix (c) is a forward-looking discipline — it prevents the NEXT mech.4-style regression from happening, not the current one.

To recover the current 0.0417 regression, the catalog would need data-side work:
- Tag the 200 RULE kurta products on the fit axis (AI-tagger or rule-engine seed).
- Get at least 2-3 of them to have fit=oversized or fit=relaxed (so the kurta fixture can recover to PARTIAL=0.50 = 3/6 satisfying).

That's a separate catalog data-quality mech. Call it (c-now) — proportional coverage RETROACTIVE on the kurta pool — vs (c-future) — proportional coverage discipline going forward.

**(c-now)** is the lever that recovers the existing regression. It's a tagging mech, not a code mech. It's also expensive: 200 products × 1 axis tag = 200 manual approvals (or 200 AI-tagger calls + 200 manual quality reviews).

**(c-future)** is the policy fix the HANDOFF amendment described.

If the planning round picks (c) alone, it should pick (c-future) — the discipline — AND optionally pair with (c-now) — a one-shot retroactive fit-tagging mech on the kurta pool. The latter is essentially the same shape as mech.3's bulk-approve-secondary-axes but scoped to the post-mech.4 200-product kurta expansion.

## 4. Comparison to (a) and (b)

| Dimension | Fix (a) | Fix (b) | Fix (c) policy | Fix (c-now) retroactive |
|---|---|---|---|---|
| **Eval recovery** | 0 (sim) | +0.028 | 0 | up to +0.05 if 3+ products land fit=oversized/relaxed |
| **Code surface** | ~25 LOC | ~80 LOC | 0 (process) or ~30 LOC (C-γ hook) | 0 LOC (script invocation) |
| **Test surface** | Minimal | Moderate | None (C-α/β) | None |
| **Reversibility** | One-line revert | Stage 5 contract change is heavier to revert | Process-only; trivial to revert by ignoring | DB writes; revert via ProductTagAudit |
| **Recovers kurta regression** | No | No | No (forward-only) | Yes (potential) |
| **Prevents next regression** | No | No | YES | No (one-shot) |

Fix (c) policy is the only fix that PREVENTS future regressions. The other fixes are surgical responses to a specific failure mode.

## 5. Architectural soundness

The HANDOFF amendment's framing of fix (c) as one of three options against the ranking gap is structurally slightly off. (c) doesn't address the ranking gap — it addresses the DATA gap (catalog secondary-axis sparsity) by preventing it from getting worse.

The ranking gap and the data gap are coupled: when data is sparse on a query's expected secondary axis, no amount of ranking work can recover the fixture (you can't rank what isn't there). When data is dense, ranking matters because there's something to rank.

Fix (c) is therefore not actually "a fix for the ranking gap." It's "a fix for the input to the ranking system." The (a) and (b) fixes operate on the ranking system itself; (c) operates on the catalog state that the ranking system reads.

For the planning round: framing (c) as a sibling of (a) and (b) is misleading. They're orthogonal concerns. The right architectural read: (c) IS the load-bearing fix — fix the catalog and the ranking gap shrinks — and (a)/(b) become marginal optimizations.

This reframing argues for **(c-future) + (c-now) as the primary 3.1.8 fix** with (a)/(b) as deferred backlog or post-flip work. Artifact 18 (fix (d) shapes) and artifact 20 (synthesis) carry this conclusion forward.

## 6. Cost/benefit assessment for 3.1.8 inclusion

| Dimension | Verdict |
|---|---|
| **Eval recovery** | 0 (forward-only). |
| **Code complexity** | 0 (C-α/β only). Optionally 30 LOC for C-γ pre-commit hook. |
| **Test surface** | None. |
| **Architectural cleanliness** | High — addresses the structural cause, not the symptom. |
| **Diagnostic value** | High — codifying the discipline keeps the lesson alive across planning rounds. |
| **Recommendation for 3.1.8** | **Ship as planning-round + HANDOFF op-debt list entry.** Zero LOC. Real value as a process gate. Optionally pair with one-shot retroactive fit-tagging on the kurta pool (c-now) if eval recovery on the kurta fixture matters for the R3.1 target. |

## 7. Implication for the (a)/(b)/(c)/(d) fork

(c) is the structurally correct fix. But (c) alone doesn't recover the existing kurta regression. The right shape for 3.1.8 is **(c-future) + (c-now)**:

- (c-future): planning-round discipline + HANDOFF op-debt entry. Free.
- (c-now): one-shot retroactive fit-tagging on the 200 RULE kurta products. Same shape as mech.3 bulk-approve, scoped to the kurta pool. Empirically uncertain on eval impact (catalog AI-tagger may not produce enough fit=oversized/relaxed APPROVED rows to lift the fixture out of FAIL bucket, given the fixture's denominator-of-6 ceiling at 0.167 unless 3+ satisfying products land).

If the planning round wants to add (a) or (b) on top: (b) adds the +0.028 lift on the linen-shirts/oos-stress fixtures. (a) is null. The marginal cost of (b) is ~80 LOC + Stage 5 contract change. Decision depends on whether the +0.028 is worth that complexity at 3.1.8 timing.

The (d) shapes in artifact 18 explore other options.
