// Deterministic rule engine for tagging (006a §5).
//
// applyRules runs enabled TaggingRule rows for a shop against a single
// product, writes RULE-source tags + audit rows, and returns:
//   { tagsWritten, axesStillNeeded }
//
// Semantics (final, post-Decision 2 + 4):
//   - Locked axes (HUMAN-source ProductTag.locked=true) are never touched.
//   - First-match-wins per axis. Once any rule writes any value to axis X
//     for this product, subsequent rules that target X are skipped.
//   - Apply-all is purely additive: rules NEVER overwrite an existing tag
//     value. If the product already has a value on axis X (from any source),
//     no rule writes to X for this product.
//   - Idempotency: re-applying the same rule that wrote the same value is
//     a no-op (no DB write, no audit row).
//
// Rules write source="RULE", confidence=1.0, locked=false. Locking remains
// a HUMAN-only operation via Mark Reviewed.
//
// Conditions are a recursive union — leaves (tag_contains, title_contains,
// type_equals, vendor_equals, price_range) and combinators (all, any, not).

import type { Product, ProductTag, TaggingRule } from "@prisma/client";
import prisma from "../../db.server";
import {
  ConditionSchema,
  EffectsSchema,
  type Condition,
  type Effect,
} from "./rule-types";

// Re-export for the only existing callers; new code should import from
// rule-types directly when it needs schemas/types on the client.
export { ConditionSchema, EffectsSchema };
export type { Condition, Effect };

// --- Condition evaluator ------------------------------------------------

type ProductForEval = Pick<
  Product,
  "title" | "productType" | "vendor" | "shopifyTags" | "priceMin" | "priceMax"
>;

export function evaluateConditions(
  product: ProductForEval,
  cond: Condition,
): boolean {
  switch (cond.kind) {
    case "tag_contains": {
      const ci = cond.ci !== false;
      const needle = ci ? cond.value.toLowerCase() : cond.value;
      return product.shopifyTags.some((t) =>
        ci ? t.toLowerCase().includes(needle) : t.includes(needle),
      );
    }
    case "title_contains": {
      const ci = cond.ci !== false;
      const hay = ci ? product.title.toLowerCase() : product.title;
      const needle = ci ? cond.value.toLowerCase() : cond.value;
      return hay.includes(needle);
    }
    case "type_equals":
      return (product.productType ?? "").toLowerCase() === cond.value.toLowerCase();
    case "vendor_equals":
      return (product.vendor ?? "").toLowerCase() === cond.value.toLowerCase();
    case "price_range": {
      const min = product.priceMin === null ? null : Number(product.priceMin);
      const max = product.priceMax === null ? null : Number(product.priceMax);
      // Treat the product as in range if either bound is missing — be
      // permissive rather than reject due to incomplete pricing data.
      if (cond.min !== undefined && min !== null && min < cond.min) return false;
      if (cond.max !== undefined && max !== null && max > cond.max) return false;
      return true;
    }
    case "all":
      return cond.conditions.every((c) => evaluateConditions(product, c));
    case "any":
      return cond.conditions.some((c) => evaluateConditions(product, c));
    case "not":
      return !evaluateConditions(product, cond.condition);
    default: {
      const _exhaustive: never = cond;
      void _exhaustive;
      return false;
    }
  }
}

// --- applyRules ----------------------------------------------------------

export type TagWrite = {
  axis: string;
  value: string;
  source: "RULE";
  confidence: number;
};

export type ApplyRulesParams = {
  shopDomain: string;
  product: Product & { tags: ProductTag[] };
  axesNeeded: readonly string[];
  rules?: readonly TaggingRule[];
  dryRun?: boolean;
  actorId?: string | null;
};

export type ApplyRulesResult = {
  tagsWritten: TagWrite[];
  axesStillNeeded: string[];
  matchedRuleIds: string[];
};

export async function applyRules(
  params: ApplyRulesParams,
): Promise<ApplyRulesResult> {
  const rules = params.rules ?? (await loadEnabledRules(params.shopDomain));

  // Filter rules to ones that target the product's taxonomy node (or any
  // ancestor) or have node scope=null. Walking ancestors needs the node row.
  const scopedRules = await filterRulesByNodeScope(rules, params.product);

  // PR-2.2-mech.2: TWO derived sets with DIFFERENT semantics. Don't
  // collapse them — they serve different filters.
  //
  // axesWithExistingValue (status-agnostic): any tag on an axis blocks
  // RULE writes to that axis. Used at the rule-write filter inside the
  // per-effect loop below. Preserves the "purely additive" semantic
  // documented in the file header — rules NEVER overwrite an existing
  // tag value, regardless of who created it or what review state it's
  // in. Conservative by design: rules are deterministic and shouldn't
  // race with merchant or AI decisions.
  const axesWithExistingValue = new Set(params.product.tags.map((t) => t.axis));

  // axesWithStickyValue (APPROVED + REJECTED only): tags the merchant
  // has acted on. Used at the axesStillNeeded computation at the end
  // of this function — controls which axes the AI sees as starter-
  // axes in its prompt. PENDING_REVIEW tags are NOT sticky here:
  // they're replaceable AI suggestions awaiting merchant review, so
  // a re-tag run should let the AI re-evaluate those axes.
  //
  // NOTE: REJECTED tags currently block the entire axis (not just
  // the rejected (axis, value) pair). The ai-tagger has its own
  // value-level exclusion via rejectedValuesByAxis in the prompt
  // payload, but the axis-level block here makes that value-level
  // guard dead code in practice. Captured as PR-2.2 operational
  // debt; revisit when the merchant review UI lands and we have
  // evidence about whether merchants want axis-level vs.
  // value-level rejection semantics.
  const axesWithStickyValue = new Set(
    params.product.tags
      .filter((t) => t.status === "APPROVED" || t.status === "REJECTED")
      .map((t) => t.axis),
  );

  const lockedAxes = new Set(
    params.product.tags.filter((t) => t.locked).map((t) => t.axis),
  );
  const axesNeededSet = new Set(params.axesNeeded);
  const writtenByAxis = new Set<string>();
  const tagsWritten: TagWrite[] = [];
  const matchedRuleIds: string[] = [];

  // Sorted ascending by priority, then createdAt asc for deterministic
  // tie-break (loadEnabledRules returns this ordering already).
  for (const rule of scopedRules) {
    const condParse = ConditionSchema.safeParse(rule.conditions);
    if (!condParse.success) continue;
    if (!evaluateConditions(params.product, condParse.data)) continue;

    const effectsParse = EffectsSchema.safeParse(rule.effects);
    if (!effectsParse.success) continue;

    let touched = false;
    for (const effect of effectsParse.data) {
      // Skip if not in the requested axes, already won by another rule,
      // already has any value (purely additive), or locked.
      if (!axesNeededSet.has(effect.axis)) continue;
      if (writtenByAxis.has(effect.axis)) continue;
      if (axesWithExistingValue.has(effect.axis)) continue;
      if (lockedAxes.has(effect.axis)) continue;

      const values = Array.isArray(effect.value) ? effect.value : [effect.value];
      writtenByAxis.add(effect.axis);
      touched = true;
      for (const v of values) {
        tagsWritten.push({ axis: effect.axis, value: v, source: "RULE", confidence: 1.0 });
      }
    }
    if (touched) matchedRuleIds.push(rule.id);
  }

  // Persist (unless dryRun). Whole batch in one transaction so a partial
  // failure can't leave the product half-tagged.
  if (!params.dryRun && tagsWritten.length > 0) {
    await prisma.$transaction(async (tx) => {
      for (const w of tagsWritten) {
        const existing = await tx.productTag.findUnique({
          where: {
            productId_axis_value: {
              productId: params.product.id,
              axis: w.axis,
              value: w.value,
            },
          },
        });
        if (existing) continue; // idempotent — no DB write, no audit
        await tx.productTag.create({
          data: {
            productId: params.product.id,
            shopDomain: params.shopDomain,
            axis: w.axis,
            value: w.value,
            source: "RULE",
            // PR-2.1: rules are merchant-authored deterministic logic,
            // therefore implicitly approved. No review queue entry for
            // rule-derived tags.
            status: "APPROVED",
            confidence: 1.0,
            locked: false,
          },
        });
        await tx.productTagAudit.create({
          data: {
            productId: params.product.id,
            shopDomain: params.shopDomain,
            axis: w.axis,
            action: "ADD_RULE",
            previousValue: null,
            newValue: w.value,
            source: "RULE",
            actorId: params.actorId ?? null,
          },
        });
      }
    });
  }

  // PR-2.2-mech.2: AI re-evaluation gating uses axesWithStickyValue
  // (APPROVED+REJECTED), NOT axesWithExistingValue. Letting PENDING_REVIEW
  // axes through means the AI re-tag path produces fresh suggestions
  // for axes where the merchant hasn't decided yet — matching the
  // PR-2.1 design intent that PENDING_REVIEW is replaceable.
  const stillNeeded = params.axesNeeded.filter(
    (a) => !writtenByAxis.has(a) && !axesWithStickyValue.has(a) && !lockedAxes.has(a),
  );

  return { tagsWritten, axesStillNeeded: stillNeeded, matchedRuleIds };
}

async function loadEnabledRules(shopDomain: string): Promise<TaggingRule[]> {
  return prisma.taggingRule.findMany({
    where: { shopDomain, enabled: true },
    orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
  });
}

// Rules with taxonomyNodeId=null target every product. Rules with a node
// id only fire when the product's matched node IS that node or descends
// from it. We resolve "descends from" by walking the product's node chain
// upward and checking membership in the rule's node set.
async function filterRulesByNodeScope(
  rules: readonly TaggingRule[],
  product: Product,
): Promise<TaggingRule[]> {
  const scoped = rules.filter((r) => r.taxonomyNodeId !== null);
  if (scoped.length === 0) return rules.slice();

  const ancestors = await ancestorIdsFor(product.taxonomyNodeId);
  return rules.filter((r) => {
    if (r.taxonomyNodeId === null) return true;
    return ancestors.has(r.taxonomyNodeId);
  });
}

async function ancestorIdsFor(
  nodeId: string | null,
): Promise<Set<string>> {
  const ids = new Set<string>();
  let current = nodeId;
  for (let i = 0; current && i < 16; i += 1) {
    ids.add(current);
    const row: { parentId: string | null } | null = await prisma.taxonomyNode.findUnique({
      where: { id: current },
      select: { parentId: true },
    });
    if (!row?.parentId) break;
    current = row.parentId;
  }
  return ids;
}

