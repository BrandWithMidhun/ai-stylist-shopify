// Shared rule-engine types + Zod schemas (006a §5).
//
// Lives in a non-`.server` module because the rules admin UI (RuleEditor)
// validates Condition/Effect JSON on the client before save. Pure data
// helpers, no Prisma / no DB access — safe to bundle in client code.

import { z } from "zod";

const StringValue = z.string().min(1).max(256);

const LeafConditionSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("tag_contains"),
    value: StringValue,
    ci: z.boolean().optional(),
  }),
  z.object({
    kind: z.literal("title_contains"),
    value: StringValue,
    ci: z.boolean().optional(),
  }),
  z.object({
    kind: z.literal("type_equals"),
    value: StringValue,
  }),
  z.object({
    kind: z.literal("vendor_equals"),
    value: StringValue,
  }),
  z.object({
    kind: z.literal("price_range"),
    min: z.number().optional(),
    max: z.number().optional(),
  }),
]);

type LeafCondition = z.infer<typeof LeafConditionSchema>;

export type Condition =
  | LeafCondition
  | { kind: "all"; conditions: Condition[] }
  | { kind: "any"; conditions: Condition[] }
  | { kind: "not"; condition: Condition };

export const ConditionSchema: z.ZodType<Condition> = z.lazy(() =>
  z.union([
    LeafConditionSchema,
    z.object({
      kind: z.literal("all"),
      conditions: z.array(ConditionSchema).min(1),
    }),
    z.object({
      kind: z.literal("any"),
      conditions: z.array(ConditionSchema).min(1),
    }),
    z.object({
      kind: z.literal("not"),
      condition: ConditionSchema,
    }),
  ]),
);

export const EffectSchema = z.object({
  axis: z.string().min(1).max(64),
  value: z.union([
    z.string().min(1).max(128),
    z.array(z.string().min(1).max(128)).min(1),
  ]),
});

export type Effect = z.infer<typeof EffectSchema>;

export const EffectsSchema = z.array(EffectSchema).min(1);
