# 006a Execute Prompt — Final

Paste the entire block below into Claude Code.

---

```
Resume execution of 006a (taxonomy + rules foundation), with 7 ambiguity resolutions, 8 additional decisions, AND multi-industry expansion baked in.

==== PART 1: AMBIGUITY RESOLUTIONS (from your plan) ====

1. SEED TRIGGER: put both seedTaxonomy and seedRules in upsertMerchantConfig (the config form save path), NOT ensureMerchantConfig. Guard each with idempotency: skip if shop already has any TaxonomyNode rows / any TaggingRule rows.

2. APPLY-ALL SEMANTICS: option (a) — rules NEVER overwrite existing tags. Apply-all is purely additive: fill gaps, never replace. Confirm dialog text:
   "This will run X enabled rules across Y products and add tags to axes that don't already have a value. Existing tags will not be changed. Locked HUMAN tags will not be touched. Continue?"

3. SEED RULE AXES: align all seeds to the EXPANDED axis-options.ts vocabulary (see Part 3 below). No axis introduced via rules that isn't in axis-options.

4. FIRST-MATCH-WINS GRANULARITY: per-axis, not per-(axis,value). Once any rule writes any value to axis X, subsequent rules for axis X are skipped entirely for that product. Multi-value rules write the full set in one shot.

5. JOB KIND RATE LIMITING: branch the 5-minute cooldown in jobs.server.ts to apply only to kind="sync" and kind="batch_tag". New kinds rematch_taxonomy and apply_rules get already-running dedupe but NO cooldown.

6. SLUG STABILITY: slug stable across renames. Recompute ONLY on parent reassignment.

7. EFFECTIVE-AXES COMPUTE: pre-compute in loader.server.ts. Build nodeAxesByNodeId map for all distinct taxonomyNodeIds in the 500-product window. Add comment noting this is O(nodes × depth) and assumes <100 nodes / <5 deep.

==== PART 2: ADDITIONAL DECISIONS ====

A. Migration name: `add_taxonomy_and_rules`. Single migration adds both tables + Product.taxonomyNodeId in one shot.

B. Seeds idempotent — see Part 1 #1.

C. Rules write source="RULE", confidence=1.0, locked=false. Locking remains HUMAN-only.

D. Apply-all and Re-match-all both follow the 005a job pattern: in-memory job registry, polling, jobId returned. Reuse useSyncJobProgress hook in UI.

E. Rules-then-AI integration: in api.products.$id.tags.generate.tsx (and the underlying generateTagsForProductById), apply rules first, collect axesStillNeeded, call AI tagger with only those axes. If axesStillNeeded is empty, SKIP the Claude call entirely and console.log "[rule-engine] rules covered all axes for product X, skipping AI". Net AI cost goes DOWN.

F. Taxonomy matcher: naive scoring. Count matchKeyword occurrences in title/productType/shopifyTags (case-insensitive), deepest leaf wins ties. Document v1 caveat in source.

G. Drawer integration: ProductEditDrawer reads from getEffectiveAxes(taxonomyNodeId) when set; falls back to axisOptionsFor(storeMode) when null. Pass effectiveAxes from Dashboard, looked up from nodeAxesByNodeId map.

H. Re-match-all toast on completion: "Matched X products to Y taxonomy nodes."

==== PART 3: INDUSTRY-AGNOSTIC EXPANSION ====

CRITICAL: 006a is the foundation for an industry-agnostic system. FASHION was over-developed; ELECTRONICS/FURNITURE/BEAUTY were sketches; GENERAL was a stub. Bring all to floor quality. Also add JEWELLERY as a 6th storeMode.

==== 3.1 EXPAND axis-options.ts ====

FASHION — keep existing 8, ADD 3 (final count: 11):
- material (multi): cotton, linen, silk, denim, wool, polyester, leather, synthetic, blended, cashmere
- size_range (multi): xs, s, m, l, xl, xxl, xxxl, one_size
- price_tier (single): budget, mid_range, premium, luxury

ELECTRONICS — keep existing 5, ADD 3 (final count: 8):
- connectivity (multi): wifi, bluetooth, wired, cellular, nfc, usb_c, lightning
- color (single): black, white, grey, silver, gold, blue, red, multicolor, clear
- target_user (multi): gamer, professional, casual, student, creator

FURNITURE — keep existing 5, ADD 3 (final count: 8):
- color (single): black, white, grey, blue, red, green, brown, beige, multicolor, natural_wood, metallic
- assembly_required (single): yes, no, minimal, professional
- price_tier (single): budget, mid_range, premium, luxury

BEAUTY — keep existing 5, ADD 3 (final count: 8):
- hair_type (multi): straight, wavy, curly, coily, fine, thick, damaged, colored, oily, dry
- formulation (single): cream, serum, oil, gel, lotion, spray, powder, stick, liquid, mask
- price_tier (single): budget, mid_range, premium, luxury

GENERAL — keep existing 4, ADD 3 (final count: 7):
- price_tier (single): budget, mid_range, premium, luxury
- size (text)
- target_audience (text)

JEWELLERY — NEW storeMode, 11 axes:
- category (single): ring, necklace, earrings, bracelet, pendant, bangle, anklet, brooch, mangalsutra, watch, nose_ring, set
- metal (single): gold, silver, platinum, rose_gold, white_gold, mixed_metal, alloy, brass, copper, fashion_metal
- purity (single): 24k, 22k, 18k, 14k, 10k, 925_silver, 800_silver, oxidized, plated, costume
- gemstone (multi): diamond, ruby, emerald, sapphire, pearl, opal, topaz, amethyst, garnet, none, synthetic, simulated, other
- craft_type (multi): kundan, polki, meenakari, temple, oxidized, filigree, beaded, threadwork, plain
- weight_grams (text)
- occasion (multi): bridal, daily, festive, party, gift, traditional, office, religious
- style (single): traditional, contemporary, minimalist, statement, vintage, fusion, antique, fashion
- target_audience (single): male, female, unisex, kids, infant
- price_tier (single): budget, mid_range, premium, luxury, fine_jewellery
- certification (multi): bis_hallmark, gia, igi, hrd, none

==== 3.2 ADD JEWELLERY TO STOREMODE ENUM ====

In prisma/schema.prisma, the StoreMode enum adds JEWELLERY. Migration must include this enum value addition.

In app/lib/catalog/store-axes-types.ts (the type leaf created in 005d): add JEWELLERY to the StoreMode union.

In app/routes/app.config.tsx (or wherever the merchant Configuration page lives): add JEWELLERY to the storeType dropdown options. Label shown to merchant: "Jewellery".

==== 3.3 TAXONOMY SEEDS PER MODE ====

In app/lib/catalog/taxonomy-seeds.ts. Cap at 4 levels deep. Each leaf has matchKeywords for routing. Non-leaf nodes can also have matchKeywords but leaf nodes win on ties (deepest leaf wins).

FASHION:
Apparel
  Tops (Shirts, T-Shirts, Kurtas, Polos, Sweaters, Tank Tops)
  Bottoms (Pants, Jeans, Shorts, Skirts)
  Outerwear (Jackets, Blazers, Coats)
  Footwear (Sneakers, Formal, Sandals, Boots)
  Ethnic (Sarees, Lehengas, Salwar Suits)
Accessories (Belts, Bags, Watches, Sunglasses, Other)
Innerwear (Underwear, Loungewear, Sleepwear)

ELECTRONICS:
Computing
  Laptops (Gaming, Business, Ultrabook, Chromebook)
  Desktops (Tower, All-in-One, Mini PC)
  Tablets (Standard, Pro, E-reader)
Mobile
  Phones (Flagship, Mid-range, Budget)
  Phone Accessories (Cases, Chargers, Mounts)
Audio
  Headphones (Over-ear, In-ear, Earbuds)
  Speakers (Bluetooth, Smart, Soundbar)
  Microphones (Studio, Streaming, Podcast)
Wearables (Smartwatch, Fitness Tracker, Smart Ring)
Smart Home (Lights, Plugs, Cameras, Hubs, Sensors)
Gaming (Consoles, Controllers, VR, Accessories)

FURNITURE:
Living Room (Sofas, Coffee Tables, TV Stands, Armchairs, Side Tables)
Bedroom (Beds, Dressers, Nightstands, Wardrobes)
Dining Room (Dining Tables, Chairs, Bar Stools, Sideboards)
Office (Desks, Office Chairs, Bookshelves, Filing Cabinets)
Outdoor (Patio Sets, Sun Loungers, Garden Furniture, Umbrellas)
Storage (Shelving, Cabinets, Trunks, Organizers)
Lighting (Floor Lamps, Table Lamps, Ceiling Lights, Sconces)
Decor (Rugs, Wall Art, Mirrors, Plants & Planters)

BEAUTY:
Skincare
  Cleansers (Face Wash, Micellar, Oil Cleanser, Exfoliators)
  Treatments (Serums, Essences, Spot Treatments, Masks)
  Moisturizers (Day Cream, Night Cream, Eye Cream, Lip Balm)
  Sun Care (Sunscreen, After-Sun, SPF Lip)
Makeup
  Face (Foundation, Concealer, Powder, Blush, Highlighter)
  Eyes (Eyeshadow, Liner, Mascara, Brows)
  Lips (Lipstick, Gloss, Liner)
Haircare
  Cleansing (Shampoo, Conditioner, Scalp Care)
  Treatment (Masks, Serums, Oils)
  Styling (Gel, Spray, Cream, Mousse)
Fragrance (Perfume, Body Mist, Cologne)
Body & Bath (Body Wash, Lotion, Scrubs, Hand Care)
Tools (Brushes, Sponges, Devices, Mirrors)

JEWELLERY:
Rings (Engagement, Wedding Bands, Daily Wear, Cocktail, Stackable, Toe Rings)
Necklaces (Chains, Pendants, Chokers, Long Necklaces, Mangalsutras)
Earrings (Studs, Hoops, Drops, Chandbalis, Jhumkas, Ear Cuffs)
Bracelets (Bangles, Cuffs, Charm Bracelets, Tennis Bracelets, Kadas)
Anklets (Single, Pair, Sets)
Sets (Bridal Sets, Festive Sets, Daily Wear Sets)
Body Jewellery (Nose Rings, Belly Chains, Hair Accessories)
Men's Jewellery (Chains, Bracelets, Rings, Cufflinks)
Children's Jewellery (Earrings, Pendants, Bracelets)

GENERAL:
A single root node "All Products" — NO children. Merchant builds the tree manually. Seed creates only the root.

For each leaf node, generate sensible matchKeywords. Examples: "Linen Shirts" → ["linen shirt", "linen"], "Kurtas" → ["kurta", "kurti"], "Bluetooth Speakers" → ["bluetooth speaker"], "Mangalsutras" → ["mangalsutra", "mangal sutra"], "Sneakers" → ["sneaker", "sneakers", "trainers", "running shoes"]. Use your best judgment for keywords that real product titles/types contain. Non-leaf nodes can have lighter keywords or none.

==== 3.4 SEED RULES PER MODE ====

In app/lib/catalog/rule-seeds.ts. All rules use ONLY the expanded axis-options vocabulary. Each rule has: name, priority (default 100, varies if needed), enabled=true, taxonomyNodeId=null (apply globally), single condition or simple all/any.

FASHION (7 rules):
1. name: "Men's products", title_contains "men's" OR tag_contains "men's" → gender=male
2. name: "Women's products", title_contains "women's" OR tag_contains "women's" → gender=female
3. name: "Unisex products", title_contains "unisex" OR tag_contains "unisex" → gender=unisex
4. name: "Kids products", title_contains "kids" OR title_contains "children" OR tag_contains "kids" → gender=kids
5. name: "Linen material", tag_contains "linen" OR title_contains "linen" → material=[linen]
6. name: "Cotton material", tag_contains "cotton" OR title_contains "cotton" → material=[cotton]
7. name: "Denim material", title_contains "denim" OR title_contains "jeans" → material=[denim]

ELECTRONICS (3 rules):
1. name: "Gaming products", tag_contains "gaming" OR title_contains "gaming" → use_case=[gaming], target_user=[gamer]
2. name: "Wireless connectivity", title_contains "wireless" OR title_contains "bluetooth" → connectivity=[bluetooth]
3. name: "Professional grade", title_contains "professional" OR title_contains " pro " → target_user=[professional]

FURNITURE (5 rules):
1. name: "Outdoor location", tag_contains "outdoor" OR title_contains "outdoor" OR title_contains "patio" → room=[outdoor]
2. name: "Wood material", title_contains "wood" OR title_contains "wooden" → material=[wood]
3. name: "Metal material", title_contains "metal" OR title_contains "steel" → material=[metal]
4. name: "Modern style", title_contains "modern" → style=modern
5. name: "Rustic style", title_contains "rustic" OR title_contains "vintage" → style=rustic

BEAUTY (5 rules):
1. name: "Vegan products", tag_contains "vegan" OR title_contains "vegan" → ingredient_class=[vegan]
2. name: "Cruelty-free products", tag_contains "cruelty-free" OR tag_contains "cruelty free" OR title_contains "cruelty" → ingredient_class=[cruelty_free]
3. name: "Anti-aging concern", tag_contains "anti-aging" OR tag_contains "anti aging" OR title_contains "anti-aging" → concern=[anti_aging]
4. name: "Moisturizer category", title_contains "moisturizer" OR title_contains "moisturising" OR title_contains "moisturiser" → category=skincare
5. name: "Shampoo category", title_contains "shampoo" → category=haircare

JEWELLERY (9 rules):
1. name: "Gold metal", tag_contains "gold" OR title_contains "gold" → metal=gold
2. name: "Silver metal", tag_contains "silver" OR title_contains "silver" → metal=silver
3. name: "Diamond gemstone", tag_contains "diamond" OR title_contains "diamond" → gemstone=[diamond]
4. name: "Bridal occasion", tag_contains "bridal" OR title_contains "bridal" OR title_contains "wedding" → occasion=[bridal]
5. name: "Men's jewellery", tag_contains "men's" OR title_contains "men's" → target_audience=male
6. name: "Kids jewellery", tag_contains "kids" OR title_contains "kids" OR title_contains "children" → target_audience=kids
7. name: "Kundan craft", tag_contains "kundan" OR title_contains "kundan" → craft_type=[kundan]
8. name: "Polki craft", tag_contains "polki" OR title_contains "polki" → craft_type=[polki]
9. name: "22k purity", title_contains "22k" OR title_contains "22 carat" OR title_contains "22ct" → purity=22k

GENERAL (0 rules): empty. Merchant defines from scratch.

==== 3.5 UI/COPY MUST BE INDUSTRY-NEUTRAL ====

When implementing taxonomy and rules admin UIs, use INDUSTRY-NEUTRAL copy. NO fashion-coded examples in tooltips, placeholders, or empty states.

Use:
- "Add a category"
- "Tag products with attributes that matter for filtering"
- "Group your products by type"

Do NOT use:
- "Tag your fashion products"
- "Build your style taxonomy"

Empty-state messages adapt to storeMode label:
- FASHION: "Build your apparel taxonomy"
- ELECTRONICS: "Build your devices taxonomy"
- FURNITURE: "Build your furniture taxonomy"
- BEAUTY: "Build your beauty taxonomy"
- JEWELLERY: "Build your jewellery taxonomy"
- GENERAL: "Build your product taxonomy"

For the rules empty state, similar adaptation:
- "Set up rules to auto-tag your <noun> products" where <noun> = apparel / devices / furniture / beauty / jewellery / products

The dashboard intelligence guide section's "Set up rules" CTA (added per spec §5.9 + decision 8): industry-neutral text "Set up rules" — no copy change per mode needed.

==== PART 4: IMPLEMENTATION ORDER ====

Follow §6 of the spec. Each step ends green: lint + typecheck + build. No commit.

1. Schema migration (add tables + Product.taxonomyNodeId + JEWELLERY enum value)
2. Expand axis-options.ts with all new axes for all 6 storeModes
3. Build seeds infrastructure (taxonomy-seeds.ts, rule-seeds.ts) — all 6 modes
4. Helper libs (taxonomy.ts, taxonomy-matcher.server.ts, rule-engine.server.ts)
5. Rules integration into Generate routes (rules first, AI for axesStillNeeded, skip AI when empty)
6. Taxonomy admin page (/app/intelligence/taxonomy)
7. Rules admin page (/app/intelligence/rules)
8. Drawer integration (ProductEditDrawer reads getEffectiveAxes)
9. Add JEWELLERY to MerchantConfig storeType picker UI
10. Stat card link (Active rules → rules page)
11. Re-match + apply-all jobs
12. Smoke test

==== PART 5: STYLE ====

Follow existing inline <style>{...}</style> per-component pattern. Polaris web components only. No new CSS architecture.

==== PART 6: HANDBACK ====

When done, hand back:
- File diff list (creates and modifies)
- Any deviations from this prompt with reasoning
- Places where reality forced a different approach
- Any new questions discovered during implementation
- Confirmation that lint + typecheck + build are green at every step

NO COMMIT — leave diff on disk for review.
```

---

## Notes for use

- This prompt is long. Paste the entire block (between the triple backticks above, NOT including the triple backticks themselves) as ONE message into Claude Code.
- Claude Code will likely take 1-2 hours to execute. It will pause for permissions on file creates — approve all (option 2 for "allow all edits this session").
- When it finishes, drop the handback into the conversation here.
