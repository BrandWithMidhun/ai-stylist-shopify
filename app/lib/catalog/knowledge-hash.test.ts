// Unit tests for the knowledge hash module. Run via `npm test`.
//
// The tests express invariants we will rely on across PR-B (worker),
// PR-C (webhooks), and PR-D (cron):
//   - same logical input ⇒ same hash, regardless of incidental ordering
//   - changing any "in-the-hash" field changes the hash
//   - changing any "out-of-the-hash" field does NOT change the hash
//   - cross-table invalidation case (refinement #4 from PR-A scope):
//     a metaobject value flowing in via referenceGid resolution shows
//     up in the canonical form so the parent product's hash changes

import { describe, it, expect } from "vitest";
import {
  buildKnowledgeCanonical,
  hashKnowledge,
  isTextualMetafieldType,
  type KnowledgeHashInput,
} from "./knowledge-hash.server";

function baseInput(): KnowledgeHashInput {
  return {
    storeMode: "FASHION",
    title: "Linen Shirt",
    productType: "Shirt",
    vendor: "Acme Apparel",
    descriptionText: "A breathable linen shirt for warm weather.",
    shopifyTags: ["linen", "summer"],
    collectionHandles: ["mens-shirts", "summer-essentials"],
    metafields: [
      {
        namespace: "specs",
        key: "fabric",
        type: "single_line_text_field",
        value: "Linen",
      },
      {
        namespace: "custom",
        key: "fit_guide",
        type: "metaobject_reference",
        value: "gid://shopify/Metaobject/123",
      },
    ],
    metaobjectRefs: [{ type: "fabric", handle: "linen" }],
  };
}

describe("hashKnowledge", () => {
  it("produces a 64-char sha256 hex string", () => {
    const h = hashKnowledge(baseInput());
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic — same input, same output", () => {
    expect(hashKnowledge(baseInput())).toBe(hashKnowledge(baseInput()));
  });

  it("is order-insensitive on shopifyTags", () => {
    const a = baseInput();
    const b = { ...a, shopifyTags: ["summer", "linen"] };
    expect(hashKnowledge(a)).toBe(hashKnowledge(b));
  });

  it("is order-insensitive on collectionHandles", () => {
    const a = baseInput();
    const b = { ...a, collectionHandles: ["summer-essentials", "mens-shirts"] };
    expect(hashKnowledge(a)).toBe(hashKnowledge(b));
  });

  it("is order-insensitive on metafields", () => {
    const a = baseInput();
    const b: KnowledgeHashInput = {
      ...a,
      metafields: [a.metafields[1], a.metafields[0]],
    };
    expect(hashKnowledge(a)).toBe(hashKnowledge(b));
  });

  it("is order-insensitive on metaobjectRefs", () => {
    const a: KnowledgeHashInput = {
      ...baseInput(),
      metaobjectRefs: [
        { type: "fabric", handle: "linen" },
        { type: "fit", handle: "regular" },
      ],
    };
    const b: KnowledgeHashInput = {
      ...a,
      metaobjectRefs: [
        { type: "fit", handle: "regular" },
        { type: "fabric", handle: "linen" },
      ],
    };
    expect(hashKnowledge(a)).toBe(hashKnowledge(b));
  });

  it("changes when title changes", () => {
    const a = baseInput();
    const b = { ...a, title: "Cotton Shirt" };
    expect(hashKnowledge(a)).not.toBe(hashKnowledge(b));
  });

  it("changes when descriptionText changes", () => {
    const a = baseInput();
    const b = { ...a, descriptionText: "Different description." };
    expect(hashKnowledge(a)).not.toBe(hashKnowledge(b));
  });

  it("changes when storeMode changes", () => {
    const a = baseInput();
    const b: KnowledgeHashInput = { ...a, storeMode: "GENERAL" };
    expect(hashKnowledge(a)).not.toBe(hashKnowledge(b));
  });

  it("changes when a textual metafield value changes", () => {
    const a = baseInput();
    const b: KnowledgeHashInput = {
      ...a,
      metafields: [
        { ...a.metafields[0], value: "Cotton" },
        a.metafields[1],
      ],
    };
    expect(hashKnowledge(a)).not.toBe(hashKnowledge(b));
  });

  it("changes when a metaobject ref handle changes (cross-table invalidation)", () => {
    // Refinement #4 from PR-A scope: tweaking a metaobject must bump the
    // parent product's hash. The hash includes the resolved metaobject
    // handle, so a fabric metaobject changing handle from "linen" to
    // "linen-blend" invalidates every product referencing it.
    const a = baseInput();
    const b: KnowledgeHashInput = {
      ...a,
      metaobjectRefs: [{ type: "fabric", handle: "linen-blend" }],
    };
    expect(hashKnowledge(a)).not.toBe(hashKnowledge(b));
  });

  it("changes when a collection handle changes (cross-table invalidation)", () => {
    // Same idea for collections: a collection rename invalidates every
    // product in it.
    const a = baseInput();
    const b: KnowledgeHashInput = {
      ...a,
      collectionHandles: ["mens-shirts", "summer-edit"],
    };
    expect(hashKnowledge(a)).not.toBe(hashKnowledge(b));
  });

  it("ignores non-textual metafield types", () => {
    const a = baseInput();
    const b: KnowledgeHashInput = {
      ...a,
      metafields: [
        ...a.metafields,
        {
          namespace: "media",
          key: "swatch",
          type: "file_reference",
          value: "gid://shopify/MediaImage/9999",
        },
      ],
    };
    // Adding a non-textual metafield should NOT change the hash.
    expect(hashKnowledge(a)).toBe(hashKnowledge(b));
  });

  it("collapses whitespace in metafield values so trailing newlines are no-ops", () => {
    const a = baseInput();
    const b: KnowledgeHashInput = {
      ...a,
      metafields: [
        { ...a.metafields[0], value: "  Linen  \n" },
        a.metafields[1],
      ],
    };
    expect(hashKnowledge(a)).toBe(hashKnowledge(b));
  });

  it("treats null nullable fields the same as undefined", () => {
    const a: KnowledgeHashInput = {
      ...baseInput(),
      productType: null,
      vendor: null,
      descriptionText: null,
    };
    const b: KnowledgeHashInput = { ...a };
    expect(hashKnowledge(a)).toBe(hashKnowledge(b));
  });
});

describe("buildKnowledgeCanonical", () => {
  it("includes every key in the canonical string", () => {
    const c = buildKnowledgeCanonical(baseInput());
    expect(c).toContain("storeMode=FASHION");
    expect(c).toContain("title=Linen Shirt");
    expect(c).toContain("productType=Shirt");
    expect(c).toContain("vendor=Acme Apparel");
    expect(c).toContain("descriptionText=");
    expect(c).toContain("shopifyTags=linen,summer");
    expect(c).toContain("collections=mens-shirts,summer-essentials");
    expect(c).toContain("metafields=");
    expect(c).toContain("metaobjects=fabric:linen");
  });
});

describe("isTextualMetafieldType", () => {
  it("accepts common textual + numeric + metaobject types", () => {
    expect(isTextualMetafieldType("single_line_text_field")).toBe(true);
    expect(isTextualMetafieldType("rich_text_field")).toBe(true);
    expect(isTextualMetafieldType("number_decimal")).toBe(true);
    expect(isTextualMetafieldType("metaobject_reference")).toBe(true);
    expect(isTextualMetafieldType("list.metaobject_reference")).toBe(true);
  });

  it("rejects file/binary/asset reference types", () => {
    expect(isTextualMetafieldType("file_reference")).toBe(false);
    expect(isTextualMetafieldType("color")).toBe(false);
    expect(isTextualMetafieldType("dimension")).toBe(false);
  });
});
