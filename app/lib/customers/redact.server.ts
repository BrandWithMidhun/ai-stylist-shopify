// PR-D D.1: GDPR redact helper.
//
// softDeleteCustomerProfile runs the full PII-scrub cascade synchronously
// in one transaction (per A3 amendment). Called by:
//   - webhooks.customers.redact (the GDPR mandatory compliance webhook)
//   - webhooks.customers.delete (customer deletion is functionally a
//     redact for our purposes — same scrub semantics, different
//     trigger source)
//
// Cascade:
//   1. CustomerProfile: set deletedAt=now(), null email/phone/firstName/
//      lastName/region. Preserve shopifyCustomerId + behavioral
//      aggregates (counts) so analytics queries don't break.
//   2. CustomerProfileAttribute: delete all rows for the profile.
//      Quiz/chat-derived attributes may contain PII (e.g. free-text
//      style preferences) and aren't safe to retain in a redacted
//      profile.
//   3. CustomerEvent.context: scrub keys matching PII_KEY_ALLOWLIST.
//      One-level-deep recursion (handles {address: {city: ...}}
//      shapes from Shopify payloads). Behavioral keys (productGid,
//      orderGid, totalCents, items, kind, etc.) are preserved.
//   4. CustomerSession.profileId: set null. The FK already does
//      onDelete: SetNull, but we don't delete the profile here —
//      the explicit update is for clarity and to break the link
//      immediately even when the profile row stays.

import type { Prisma } from "@prisma/client";
import basePrisma from "../../db.server";

// Keys to remove when scrubbing CustomerEvent.context. Match Shopify
// customer/order payload shapes plus generic PII fields. Lowercase
// comparison; behavioral keys are preserved by exclusion.
export const PII_KEY_ALLOWLIST: ReadonlyArray<string> = [
  "email",
  "phone",
  "firstname",
  "lastname",
  "name",
  "address",
  "address1",
  "address2",
  "city",
  "zip",
  "postalcode",
  "country",
];

// One-level-deep recursive scrub. Returns a fresh object with PII keys
// removed at the top level and inside any single-level nested objects.
// Arrays: each element is scrubbed if it's an object; primitives pass
// through. Deeper nesting is rare in Shopify payloads but if it
// surfaces we either widen the depth here or accept that deeper PII
// goes unscrubbed (and document the gap).
export function scrubEventContext(
  context: unknown,
  allowlist: ReadonlyArray<string> = PII_KEY_ALLOWLIST,
): Prisma.InputJsonValue {
  if (context === null || typeof context !== "object") {
    return context as Prisma.InputJsonValue;
  }
  if (Array.isArray(context)) {
    return context.map((item) =>
      item !== null && typeof item === "object"
        ? scrubObject(item as Record<string, unknown>, allowlist)
        : (item as Prisma.InputJsonValue),
    ) as Prisma.InputJsonValue;
  }
  return scrubObject(context as Record<string, unknown>, allowlist);
}

function scrubObject(
  obj: Record<string, unknown>,
  allowlist: ReadonlyArray<string>,
): Prisma.InputJsonValue {
  const out: Record<string, Prisma.InputJsonValue> = {};
  const drop = new Set(allowlist.map((k) => k.toLowerCase()));
  for (const [key, value] of Object.entries(obj)) {
    if (drop.has(key.toLowerCase())) continue;
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      const nested: Record<string, Prisma.InputJsonValue> = {};
      for (const [nk, nv] of Object.entries(value as Record<string, unknown>)) {
        if (drop.has(nk.toLowerCase())) continue;
        nested[nk] = nv as Prisma.InputJsonValue;
      }
      out[key] = nested;
    } else if (Array.isArray(value)) {
      out[key] = value.map((v) =>
        v !== null && typeof v === "object" && !Array.isArray(v)
          ? scrubObject(v as Record<string, unknown>, allowlist)
          : (v as Prisma.InputJsonValue),
      ) as Prisma.InputJsonValue;
    } else {
      out[key] = value as Prisma.InputJsonValue;
    }
  }
  return out;
}

export type SoftDeleteResult = {
  profileFound: boolean;
  attributesDeleted: number;
  eventsScrubbed: number;
  sessionsDetached: number;
};

export async function softDeleteCustomerProfile(
  shopDomain: string,
  shopifyCustomerId: string,
  prisma = basePrisma,
): Promise<SoftDeleteResult> {
  return prisma.$transaction(async (tx) => {
    const profile = await tx.customerProfile.findUnique({
      where: {
        shopDomain_shopifyCustomerId: {
          shopDomain,
          shopifyCustomerId,
        },
      },
      select: { id: true },
    });
    if (!profile) {
      return {
        profileFound: false,
        attributesDeleted: 0,
        eventsScrubbed: 0,
        sessionsDetached: 0,
      };
    }

    await tx.customerProfile.update({
      where: { id: profile.id },
      data: {
        deletedAt: new Date(),
        email: null,
        phone: null,
        firstName: null,
        lastName: null,
        region: null,
      },
    });

    const attrDelete = await tx.customerProfileAttribute.deleteMany({
      where: { profileId: profile.id },
    });

    const events = await tx.customerEvent.findMany({
      where: { profileId: profile.id },
      select: { id: true, context: true },
    });
    let eventsScrubbed = 0;
    for (const event of events) {
      const scrubbed = scrubEventContext(event.context as unknown);
      await tx.customerEvent.update({
        where: { id: event.id },
        data: { context: scrubbed },
      });
      eventsScrubbed += 1;
    }

    const sessionsDetach = await tx.customerSession.updateMany({
      where: { profileId: profile.id },
      data: { profileId: null },
    });

    return {
      profileFound: true,
      attributesDeleted: attrDelete.count,
      eventsScrubbed,
      sessionsDetached: sessionsDetach.count,
    };
  });
}
