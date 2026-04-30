// Phase 1 (PR-C, C.3): unit tests for needsReauth.
//
// 7 cases per execution prompt. Run via `npm test`.

import { describe, it, expect } from "vitest";
import { needsReauth } from "./needs-reauth";

describe("needsReauth", () => {
  it("returns true when an expected scope is missing from session", () => {
    expect(
      needsReauth("read_products", ["read_products", "read_orders"]),
    ).toBe(true);
  });

  it("returns false when all expected scopes are present", () => {
    expect(
      needsReauth("read_products,read_orders", ["read_products"]),
    ).toBe(false);
  });

  it("returns false when session has extras beyond expected", () => {
    expect(
      needsReauth("read_products,read_orders,read_customers", ["read_products"]),
    ).toBe(false);
  });

  it("returns true when session is null", () => {
    expect(needsReauth(null, ["read_products"])).toBe(true);
  });

  it("returns true when session is undefined", () => {
    expect(needsReauth(undefined, ["read_products"])).toBe(true);
  });

  it("returns false when expected is empty (no requirements)", () => {
    expect(needsReauth("read_products", [])).toBe(false);
  });

  it("returns true when session is empty string", () => {
    expect(needsReauth("", ["read_products"])).toBe(true);
  });

  // Surfaced during C.3 Q5 verification: Shopify session.scope only
  // carries literal grants, but write_X implies read_X at runtime. A
  // strict literal check would falsely flag a re-auth for a shop that
  // granted write_X without an explicit read_X. The expansion in
  // expandGranted() handles this; the test pins the contract.
  it("returns false when write_X grants imply read_X", () => {
    expect(
      needsReauth("write_products,write_customers", [
        "read_products",
        "write_products",
        "read_customers",
        "write_customers",
      ]),
    ).toBe(false);
  });
});
