// PR-3.1-mech.4: heuristic query extraction for Stage 3 re-rank inputs.
//
// Pure function. NO LLM call (per locked decision D1 — latency budget
// 8s p95 / 5s p50; an LLM call adds 800-1500ms minimum). Tracked in
// HANDOFF as operational debt to revisit when Phase 5 multi-mode
// re-rankers ship and we have latency headroom.
//
// Approach (two passes, additive):
//   1. Direct AXIS_OPTIONS.FASHION value match: tokenize the intent
//      and check each FASHION axis's allowed values for token-level
//      match (case-insensitive, word-boundary).
//   2. Synonym dict: hand-curated user-typed phrases mapped to
//      (axis, value) pairs. Phrase matching uses word-boundary regex
//      against the lowered intent string so "men" doesn't false-
//      positive inside "women".
//
// Profile overrides (per locked decision D6):
//   - profile.fitPreference set → QueryAttributes.fit = [profile.fitPreference]
//     (overwrite, not merge — fit is a personal preference and the
//     query string isn't expected to override it).
//   - profile.preferredColors set + non-empty → MERGED into
//     QueryAttributes.color_family (the user might query a specific
//     color, but their stored preferences widen the range).
//   - profile.preferredOccasions same shape on QueryAttributes.occasion.
//   - profile.bodyType is NOT a query axis — the body-type re-ranker
//     reads it directly from the profile snapshot.
//
// Fixture-by-fixture rationale (the 12 mech.1 eval fixtures):
//
//   1. fashion-linen-shirts-white      "show me white linen shirts"
//      → category:["shirt"] (synonym shirts→shirt),
//        color_family:["white"] (direct AXIS_OPTIONS match),
//        material:["linen"]    (direct AXIS_OPTIONS match)
//
//   2. fashion-oversized-fit-kurta     "oversized fit kurta"
//      → fit:["oversized"], category:["kurta"]   (both direct)
//
//   3. fashion-festive-kurta-women     "festive kurta for women"
//      → occasion:["festive"], category:["kurta"]   (direct),
//        gender:["female"]    (synonym women→female)
//
//   4. fashion-summer-shorts-size-m    "summer shorts in size M"
//      → season:["summer"], category:["shorts"]   (direct),
//        size_range:["m"]    (synonym phrase "size m"→m;
//        single-letter "m" is too ambiguous for a token-level match)
//
//   5. fashion-minimalist-daily-wear   "minimalist daily wear"
//      → style_type:["minimal"]   (synonym minimalist→minimal),
//        occasion:["casual"]   (synonym daily→casual)
//
//   6. fashion-wedding-reception       "something for a wedding reception"
//      → occasion:["festive","event"]   (synonyms wedding→festive,
//        reception→event)
//
//   7. fashion-casual-office-shirts    "casual office shirts"
//      → occasion:["casual","work"]   (direct casual; synonym office→work),
//        category:["shirt"]   (synonym shirts→shirt)
//
//   8. fashion-going-out-outfit        "going out outfit for evening"
//      → occasion:["event"]   (multi-word synonym "going out"→event,
//        plus token synonym evening→event; deduplicates to single value)
//
//   9. fashion-show-jackets            "show me jackets"
//      → category:["jacket"]   (synonym jackets→jacket)
//
//   10. fashion-show-trousers          "what trousers do you have"
//       → category:["pants"]   (synonym trousers→pants;
//       pants is the FASHION vocabulary value — the synonym is the
//       single most important entry in the dict, anchoring the
//       category-vocab gap explicit in the fixture's notes field)
//
//   11. fashion-oos-stress-1           "white linen shirt for daily wear"
//       → category:["shirt"], color_family:["white"],
//         material:["linen"]   (direct + synonym shirt;
//         daily→casual adds occasion:["casual"])
//
//   12. fashion-oos-stress-2           "festive saree for an evening event"
//       → occasion:["festive","event"]   (direct festive +
//         synonym evening→event + direct event),
//         category:["saree"]
//
// Synonym dict size: 31 entries. Hand-curated against the 12
// fixtures. Cap is 30-50 per planning decision D7 (>50 means the
// heuristic is the wrong shape; <20 means it isn't doing real work).

import { AXIS_OPTIONS } from "../../../catalog/axis-options";
import type {
  CustomerProfileSnapshot,
  QueryAttributes,
  StoreMode,
} from "../types";

// FASHION axes whose allowed values are typed inputs the user might
// emit verbatim. Excludes axes with free-text type ("sub_category"
// is `text`) or values too ambiguous to token-match safely
// ("size_range" values like "m" / "s" are handled via the synonym
// dict's "size m" / "size s" phrases).
const FASHION_DIRECT_MATCH_AXES: readonly string[] = [
  "gender",
  "category",
  "fit",
  "color_family",
  "occasion",
  "style_type",
  "sleeve_length",
  "pattern",
  "collar_type",
  "season",
  "material",
  "sustainability",
  "statement_piece",
  "price_tier",
];

// User-typed phrase → (axis, value) FASHION synonym dictionary.
// Hand-curated from the 12 mech.1 eval fixture intents (see file
// header for the fixture-by-fixture map). Cap 30-50 per decision D7.
type SynonymEntry = { axis: string; value: string };
const FASHION_SYNONYMS: Record<string, SynonymEntry> = {
  // Categories: plural / singular / vocabulary-gap normalisation.
  shirts: { axis: "category", value: "shirt" },
  jackets: { axis: "category", value: "jacket" },
  kurtas: { axis: "category", value: "kurta" },
  trousers: { axis: "category", value: "pants" },
  pants: { axis: "category", value: "pants" },
  dresses: { axis: "category", value: "dress" },
  sarees: { axis: "category", value: "saree" },
  lehengas: { axis: "category", value: "lehenga" },
  skirts: { axis: "category", value: "skirt" },
  sweaters: { axis: "category", value: "sweater" },

  // Genders.
  women: { axis: "gender", value: "female" },
  woman: { axis: "gender", value: "female" },
  ladies: { axis: "gender", value: "female" },
  men: { axis: "gender", value: "male" },
  man: { axis: "gender", value: "male" },

  // Occasions.
  daily: { axis: "occasion", value: "casual" },
  everyday: { axis: "occasion", value: "casual" },
  office: { axis: "occasion", value: "work" },
  wedding: { axis: "occasion", value: "festive" },
  reception: { axis: "occasion", value: "event" },
  evening: { axis: "occasion", value: "event" },
  party: { axis: "occasion", value: "event" },
  "going out": { axis: "occasion", value: "event" },

  // Style synonyms.
  minimalist: { axis: "style_type", value: "minimal" },
  loose: { axis: "fit", value: "relaxed" },
  fitted: { axis: "fit", value: "slim" },

  // Sizes (multi-word phrases — single-letter "m" / "s" are too
  // ambiguous for a standalone token match).
  "size m": { axis: "size_range", value: "m" },
  "size s": { axis: "size_range", value: "s" },
  "size l": { axis: "size_range", value: "l" },
  "size xl": { axis: "size_range", value: "xl" },
  "size xs": { axis: "size_range", value: "xs" },
};

const TOKEN_SPLIT_RE = /[\s,.;:!?()]+/;

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function attach(qa: QueryAttributes, axis: string, value: string): void {
  const existing = qa[axis];
  if (!existing) {
    qa[axis] = [value];
    return;
  }
  if (!existing.includes(value)) existing.push(value);
}

export function extractQueryAttributes(
  intent: string,
  mode: StoreMode,
  profile?: CustomerProfileSnapshot,
): QueryAttributes {
  const qa: QueryAttributes = {};
  if (mode !== "FASHION") {
    // Phase 5 will register per-mode extractors. For 3.1, FASHION-only.
    // Profile overrides still apply on the way out so the contract is
    // consistent across modes.
    return applyProfileOverrides(qa, profile);
  }

  const lowered = intent.toLowerCase();
  const tokens = lowered.split(TOKEN_SPLIT_RE).filter(Boolean);
  const tokenSet = new Set(tokens);

  // Pass 1 — direct AXIS_OPTIONS.FASHION value match (token-level for
  // single-token values; word-boundary substring match for multi-token
  // values like "all_season" → "all season").
  const fashionAxes = AXIS_OPTIONS.FASHION;
  for (const axis of FASHION_DIRECT_MATCH_AXES) {
    const def = fashionAxes[axis];
    if (!def || def.type === "text") continue;
    for (const value of def.values) {
      if (tokenSet.has(value)) {
        attach(qa, axis, value);
        continue;
      }
      if (value.includes("_")) {
        const phrase = value.replace(/_/g, " ");
        const re = new RegExp(`\\b${escapeRegex(phrase)}\\b`);
        if (re.test(lowered)) attach(qa, axis, value);
      }
    }
  }

  // Pass 2 — synonym dict. Word-boundary regex against the lowered
  // intent so single-token entries don't false-positive on substrings
  // (e.g. "men" inside "women", "man" inside "manage").
  for (const [phrase, entry] of Object.entries(FASHION_SYNONYMS)) {
    const re = new RegExp(`\\b${escapeRegex(phrase)}\\b`);
    if (re.test(lowered)) attach(qa, entry.axis, entry.value);
  }

  return applyProfileOverrides(qa, profile);
}

function applyProfileOverrides(
  qa: QueryAttributes,
  profile?: CustomerProfileSnapshot,
): QueryAttributes {
  if (!profile) return qa;

  // fitPreference: overwrite. Fit is a personal preference; the query
  // string typically reflects the immediate need but the profile
  // captures the durable preference.
  if (profile.fitPreference) {
    qa.fit = [profile.fitPreference];
  }
  // preferredColors: merge.
  if (profile.preferredColors && profile.preferredColors.length > 0) {
    for (const c of profile.preferredColors) attach(qa, "color_family", c);
  }
  // preferredOccasions: merge.
  if (profile.preferredOccasions && profile.preferredOccasions.length > 0) {
    for (const o of profile.preferredOccasions) attach(qa, "occasion", o);
  }

  return qa;
}
