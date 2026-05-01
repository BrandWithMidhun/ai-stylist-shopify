// PR-D D.3: convenience accessors for GqlCustomer — null-safety on
// the post-deprecation defaultEmailAddress / defaultPhoneNumber /
// defaultAddress shapes.

import { describe, it, expect } from "vitest";
import {
  customerEmail,
  customerPhone,
  customerRegion,
  type GqlCustomer,
} from "./customers.server";

function baseCustomer(overrides: Partial<GqlCustomer> = {}): GqlCustomer {
  return {
    id: "gid://shopify/Customer/1",
    firstName: null,
    lastName: null,
    locale: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    defaultEmailAddress: null,
    defaultPhoneNumber: null,
    defaultAddress: null,
    ...overrides,
  };
}

describe("customerEmail", () => {
  it("returns the inner emailAddress when both levels are populated", () => {
    expect(
      customerEmail(
        baseCustomer({
          defaultEmailAddress: { emailAddress: "alice@example.com" },
        }),
      ),
    ).toBe("alice@example.com");
  });

  it("returns null when the outer object is null", () => {
    expect(customerEmail(baseCustomer({ defaultEmailAddress: null }))).toBeNull();
  });

  it("returns null when the inner emailAddress is null", () => {
    expect(
      customerEmail(
        baseCustomer({ defaultEmailAddress: { emailAddress: null } }),
      ),
    ).toBeNull();
  });
});

describe("customerPhone", () => {
  it("returns the inner phoneNumber when populated", () => {
    expect(
      customerPhone(
        baseCustomer({ defaultPhoneNumber: { phoneNumber: "+15551234567" } }),
      ),
    ).toBe("+15551234567");
  });

  it("returns null when the outer object is null", () => {
    expect(customerPhone(baseCustomer({ defaultPhoneNumber: null }))).toBeNull();
  });

  it("returns null when the inner phoneNumber is null", () => {
    expect(
      customerPhone(
        baseCustomer({ defaultPhoneNumber: { phoneNumber: null } }),
      ),
    ).toBeNull();
  });
});

describe("customerRegion", () => {
  it("returns the address country when populated", () => {
    expect(
      customerRegion(
        baseCustomer({
          defaultAddress: { country: "United States", countryCodeV2: "US" },
        }),
      ),
    ).toBe("United States");
  });

  it("returns null when defaultAddress is null", () => {
    expect(customerRegion(baseCustomer({ defaultAddress: null }))).toBeNull();
  });

  it("returns null when country is null even if countryCodeV2 is present", () => {
    expect(
      customerRegion(
        baseCustomer({
          defaultAddress: { country: null, countryCodeV2: "US" },
        }),
      ),
    ).toBeNull();
  });
});
