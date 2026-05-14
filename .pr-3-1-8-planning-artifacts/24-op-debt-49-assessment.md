# Artifact 24 — Op debt #49 assessment: broader category-coverage gap

## 1. Verbatim re-pull (HANDOFF.md:727)

> 49. Broader category-coverage gap on dev shop: only 51/1,168 ACTIVE products had any `category` ProductTag row pre-mech.4 (all source=AI, ~4.3% coverage). The AI-tagger ran but missed 97% of the catalog on this axis specifically (other axes show different coverage patterns per mech.3.5's `05-axis-coverage-post-mech-3.txt`). Cause is probably an AI-tagger prompt or sampling bias affecting category specifically. mech.4 closes part of the gap for shorts (253 products, raising category coverage to ~26%) via rule-engine. Closing the rest requires either (a) re-running the AI-tagger with prompt adjustments, (b) adding more rule-engine seeds for common categories (shirt, jacket, kurta, etc. — title-pattern → category mapping), or (c) bulk-approving any existing sub-0.8 confidence category PENDING_REVIEW rows the AI-tagger left behind. Out of 3.1.7 scope; revisit at 3.1.8 planning round (category coverage may be a v1→v2 flip prerequisite per op debt #45's "real merchant pathology" question).

## 2. Current empirical state

Probe output:

```
== #49 broader category coverage ==
  APPROVED category by value:
    innerwear            5
    jacket               5
    kurta                202
    pants                8
    shirt                26
    shorts               53
    t_shirt              4
  Total APPROVED category rows: 303
  Distinct products with APPROVED category: 303
  Coverage: 303/1169 = 25.92%
  source=RULE: 253
  source=AI: 50
```

**No drift since 3.1.7 mech.4.5.** 303 distinct products / 1169 ACTIVE = 25.92% coverage. The composition:
- 50 AI-tagged rows (mostly the small clusters: innerwear 5, jacket 5, pants 8, shirt 26, t_shirt 4, plus 2 kurta).
- 253 RULE-tagged rows (200 kurta from the retroactive Kurta rule + 53 shorts from mech.4's Shorts category rule).

Coverage gap: 866 of 1169 = 74.08% of ACTIVE products have NO APPROVED category tag.

## 3. Scope estimate — what closing this debt requires

Multiple paths, each with different scope:

- **(a) AI-tagger re-run with prompt adjustments.** Re-prompt to specifically target categories on the 866 untagged products. Requires identifying what the AI-tagger is currently misclassifying (probably "no inference" rather than "wrong inference"). Scope: ~50 LOC prompt changes + verification probe + bulk-approve pass for the new APPROVED rows. Medium mech.
- **(b) Add more rule-engine seeds** for common categories. SEED_RULES.FASHION currently only has "Shorts category"; needs additions for shirt, jacket, kurta, pants, dress, t_shirt, etc. Each is ~5 LOC of seed definition. ~50-80 LOC total + verification pass. Medium-small mech.
- **(c) Bulk-approve sub-0.8 category PENDING_REVIEW rows.** Risk: poor-quality APPROVED tags. Same calibration-discipline issue as #46.

Path (b) is the cleanest. Each new seed is a deterministic title-pattern match; results are auditable via the rule-engine.

Notable interaction with **#51**: closing #49 via path (b) requires adding seeds to SEED_RULES.FASHION. But the dev shop ALREADY has hand-customized rules (kurta, jeans, linen→sub_category, cotton→sub_category) that differ from SEED_RULES. Adding shirt/jacket/pants seeds to SEED_RULES would create more divergence if the dev shop's TaggingRule table isn't also updated. **#51 needs to be resolved first or in parallel** to maintain canonical-source consistency.

## 4. Implementation surface

Path (b) implementation:
- **`app/lib/catalog/rule-seeds.ts`:** add 5-10 new RuleSeed entries (shirt, jacket, kurta, pants, dress, t_shirt, sweater, skirt). ~50-80 LOC.
- **`scripts/apply-rules-to-shop.ts`:** invoke with `--axes=category` for the dev shop. No source changes.
- **Verification probe:** ~30 LOC.
- **Eval rerun:** standard.

If #51 is being resolved alongside: also need to either:
- Update the dev shop's TaggingRule table to match SEED_RULES (option β of #51 — reset shop to match code).
- OR update SEED_RULES to match the dev shop's hand-customized rules and add the missing categories (option α of #51).

## 5. Eval movement prediction

The fixtures affected by category coverage (those with `category` in `expectedTagFilters`):

| Fixture | Required category | Current Stage 1 candidates (Thread 3 art 13) |
|---|---|---:|
| fashion-casual-office-shirts | shirt | 26 (PASS) |
| fashion-festive-kurta-women | kurta + gender=female | 0 (EMPTY) |
| fashion-linen-shirts-white | shirt | 26 (PARTIAL_RECOVERY_POSSIBLE) |
| fashion-oos-stress-1 | shirt | 26 (PARTIAL_RECOVERY_POSSIBLE) |
| fashion-oos-stress-2 | saree | 0 (EMPTY — but op debt #48 confirms no saree merchandise) |
| fashion-oversized-fit-kurta | kurta | 202 (STAGE_2_NARROWING_DROPS) |
| fashion-show-jackets | jacket | 5 (PASS) |
| fashion-show-trousers | pants | 8 (PASS) |
| fashion-summer-shorts-size-m | shorts + size_range=m | 53 (NO_SATISFYING — blocked by #46) |

Closing #49 wouldn't help PASS fixtures (already at 1.0). It also wouldn't help the EMPTY fixtures (gender=female #43 and saree merchandise #48 are separate blockers). The kurta and shorts fixtures are bottlenecked downstream (Stage 2 narrowing #53; size_range #46).

**Eval impact prediction: 0 to marginal positive.** Closing #49 expands the candidate pool for queries on uncovered categories (dress, sweater, skirt, etc.) but those categories aren't in the current fixture suite. The fixture-suite-measured eval impact is near zero.

Real-merchant traffic post-flip would benefit much more — wider category coverage = better Stage 1 retrieval for arbitrary queries.

## 6. Coupling to other debts

- **#51 SEED_RULES divergence:** strong coupling. Closing #49 via rule-engine seeds (path b) requires resolving the canonical-source question first. Otherwise the seed additions either conflict with or duplicate the dev-shop hand-customized rules.
- **#43 gender=female:** weak coupling. Both involve rule-engine work but on different axes.
- **#50 multi-tenant verification:** each store mode needs its own category-coverage strategy. Phase 5 territory.
- **d.2-strict (Thread 3 recommendation for 3.2):** d.2-strict's effectiveness improves with broader category coverage, but indirectly. d.2-strict's hard filter operates on extracted query axes; if the extractor produces `category=jacket` but only 5 products have APPROVED jacket, d.2-strict returns 5 candidates. Closing #49 (more jacket coverage) helps d.2-strict's pool size for jacket queries.

## 7. Triage verdict

**(N) next-sub-bundle.**

Reasoning:
- The flip itself doesn't depend on category coverage. v1 was retrieving from the same catalog and producing the same results; v2 inherits the gap.
- Closing #49 requires resolving #51 first (canonical-source decision), which itself is a 3.2 candidate.
- Eval impact on the fixture suite is near zero; the real value is for arbitrary real-merchant queries which only matter post-flip.

**Why NOT bundle-with-flip (B):**
- Scope (~50-80 LOC seeds + verification) is moderate; not justified absent a clear flip-quality argument.
- Coupling to #51's canonical-source decision adds discussion-overhead that isn't worth absorbing into 3.1.8.

**Recommendation:** carry to 3.2 as part of the "catalog-data cluster" (#46, #49, #51). Sequence #51 first (decide canonical source), then #49 (add seeds), then #46 (variant-option size extractor) if time permits.
