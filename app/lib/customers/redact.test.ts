// PR-D D.1: unit tests for scrubEventContext (the trickiest piece in
// the GDPR redact cascade). DB-side cascade is integration-tested via
// post-deploy run; this verifies the in-memory scrub recursion.

import { describe, it, expect } from "vitest";
import {
  PII_KEY_ALLOWLIST,
  scrubEventContext,
} from "./redact.server";

describe("scrubEventContext", () => {
  it("removes top-level PII keys", () => {
    const result = scrubEventContext({
      email: "x@y.com",
      phone: "+1",
      productGid: "gid://shopify/Product/1",
    });
    expect(result).toEqual({ productGid: "gid://shopify/Product/1" });
  });

  it("preserves behavioral keys", () => {
    const result = scrubEventContext({
      productGid: "gid://shopify/Product/1",
      kind: "PRODUCT_VIEWED",
      totalCents: 1500,
      orderGid: "gid://shopify/Order/9",
    });
    expect(result).toEqual({
      productGid: "gid://shopify/Product/1",
      kind: "PRODUCT_VIEWED",
      totalCents: 1500,
      orderGid: "gid://shopify/Order/9",
    });
  });

  it("drops top-level objects whose key matches the allowlist", () => {
    // `address` is in the allowlist, so the entire object is removed —
    // the safer GDPR posture. Sub-keys inside an address object aren't
    // examined because the outer key already qualified for redaction.
    const result = scrubEventContext({
      orderGid: "gid://shopify/Order/9",
      address: { city: "Mumbai", country: "IN", line1: "non-pii" },
    });
    expect(result).toEqual({ orderGid: "gid://shopify/Order/9" });
  });

  it("strips PII inside non-PII-keyed nested objects", () => {
    // `shipping` is NOT in the allowlist, so the object survives — but
    // its nested PII keys (city, country) get scrubbed.
    const result = scrubEventContext({
      orderGid: "gid://shopify/Order/9",
      shipping: { method: "Express", city: "Mumbai", country: "IN" },
    });
    expect(result).toEqual({
      orderGid: "gid://shopify/Order/9",
      shipping: { method: "Express" },
    });
  });

  it("scrubs PII inside array elements", () => {
    const result = scrubEventContext({
      orderGid: "gid://shopify/Order/9",
      items: [
        { productGid: "gid://shopify/Product/1", quantity: 2, name: "drop me" },
        { productGid: "gid://shopify/Product/2", quantity: 1 },
      ],
    });
    expect(result).toEqual({
      orderGid: "gid://shopify/Order/9",
      items: [
        { productGid: "gid://shopify/Product/1", quantity: 2 },
        { productGid: "gid://shopify/Product/2", quantity: 1 },
      ],
    });
  });

  it("handles case-insensitive PII key matching", () => {
    const result = scrubEventContext({
      Email: "x@y.com",
      PHONE: "+1",
      FirstName: "Alice",
      productGid: "gid://shopify/Product/1",
    });
    expect(result).toEqual({ productGid: "gid://shopify/Product/1" });
  });

  it("returns primitives unchanged", () => {
    expect(scrubEventContext("string")).toBe("string");
    expect(scrubEventContext(42)).toBe(42);
    expect(scrubEventContext(null)).toBe(null);
    expect(scrubEventContext(true)).toBe(true);
  });

  it("PII allowlist exposes the documented keys", () => {
    expect(PII_KEY_ALLOWLIST).toContain("email");
    expect(PII_KEY_ALLOWLIST).toContain("phone");
    expect(PII_KEY_ALLOWLIST).toContain("firstname");
    expect(PII_KEY_ALLOWLIST).toContain("lastname");
    expect(PII_KEY_ALLOWLIST).toContain("address");
    expect(PII_KEY_ALLOWLIST).toContain("city");
    expect(PII_KEY_ALLOWLIST).toContain("zip");
    expect(PII_KEY_ALLOWLIST).toContain("country");
  });
});
