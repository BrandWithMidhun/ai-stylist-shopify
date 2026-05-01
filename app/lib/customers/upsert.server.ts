// PR-D D.1: customer profile + event write helpers.
//
// upsertCustomerProfile is keyed on (shopDomain, shopifyCustomerId).
// shopifyCustomerId may be null for anonymous-originated profiles per
// brief §5; in that case the unique constraint allows multiple rows
// per shop (Postgres treats NULL as distinct) and the merge primitive
// (Phase 5) consolidates them when identification arrives. PR-D's
// callers are all webhook-driven, so they always have a concrete
// shopifyCustomerId — anonymous-row creation lands later.
//
// recordCustomerEvent writes to the append-only behavioral stream.
// Pre-merge events (profileId null, sessionId set) survive merge
// because CustomerSession.profileId update preserves CustomerEvent
// history through the FK relationship.
//
// Both helpers accept an optional `tx` parameter to compose with
// outer transactions (e.g. softDeleteCustomerProfile cascades).
// Default is the global prisma client.

import type { Prisma, PrismaClient } from "@prisma/client";
import basePrisma from "../../db.server";

type PrismaLike = PrismaClient | Prisma.TransactionClient;

export type CustomerProfileUpsertInput = {
  shopDomain: string;
  shopifyCustomerId: string;
  email?: string | null;
  phone?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  locale?: string | null;
  region?: string | null;
  shopifyCreatedAt?: Date | null;
  shopifyUpdatedAt?: Date | null;
};

export async function upsertCustomerProfile(
  input: CustomerProfileUpsertInput,
  tx: PrismaLike = basePrisma,
): Promise<{ id: string; created: boolean }> {
  const existing = await tx.customerProfile.findUnique({
    where: {
      shopDomain_shopifyCustomerId: {
        shopDomain: input.shopDomain,
        shopifyCustomerId: input.shopifyCustomerId,
      },
    },
    select: { id: true, deletedAt: true },
  });

  if (existing) {
    // If a profile was previously soft-deleted (GDPR redact / customer
    // deletion) and Shopify subsequently delivers a customers/update or
    // customers/create for the same shopifyCustomerId, we resurrect by
    // clearing deletedAt. Operationally rare; documenting the path.
    await tx.customerProfile.update({
      where: { id: existing.id },
      data: {
        email: input.email ?? null,
        phone: input.phone ?? null,
        firstName: input.firstName ?? null,
        lastName: input.lastName ?? null,
        locale: input.locale ?? null,
        region: input.region ?? null,
        shopifyCreatedAt: input.shopifyCreatedAt ?? null,
        shopifyUpdatedAt: input.shopifyUpdatedAt ?? null,
        syncedAt: new Date(),
        deletedAt: null,
      },
    });
    return { id: existing.id, created: false };
  }

  const created = await tx.customerProfile.create({
    data: {
      shopDomain: input.shopDomain,
      shopifyCustomerId: input.shopifyCustomerId,
      email: input.email ?? null,
      phone: input.phone ?? null,
      firstName: input.firstName ?? null,
      lastName: input.lastName ?? null,
      locale: input.locale ?? null,
      region: input.region ?? null,
      shopifyCreatedAt: input.shopifyCreatedAt ?? null,
      shopifyUpdatedAt: input.shopifyUpdatedAt ?? null,
      originatedFromAgent: false,
    },
    select: { id: true },
  });
  return { id: created.id, created: true };
}

export type CustomerEventInput = {
  shopDomain: string;
  profileId: string | null;
  sessionId: string | null;
  kind: Prisma.CustomerEventCreateInput["kind"];
  context: Prisma.InputJsonValue;
  occurredAt?: Date;
};

export async function recordCustomerEvent(
  input: CustomerEventInput,
  tx: PrismaLike = basePrisma,
): Promise<{ id: string }> {
  const created = await tx.customerEvent.create({
    data: {
      shopDomain: input.shopDomain,
      profileId: input.profileId,
      sessionId: input.sessionId,
      kind: input.kind,
      context: input.context,
      occurredAt: input.occurredAt ?? new Date(),
    },
    select: { id: true },
  });
  return { id: created.id };
}
