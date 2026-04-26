// Server-side helpers for the public chat endpoint.
//
// v1: anonymous sessions only — sessionId is a UUID generated client-side
// and stored in a 30-day cookie. No DB persistence, no customer account
// linking. Linking to Shopify customer IDs happens in 011 alongside the
// quiz / onboarding work.

import prisma from "../../db.server";

// shopDomain validation: reject requests for any shop that hasn't installed
// the app. The Session table is the canonical "installed shops" list — if
// no row exists for the domain, the app isn't installed there.
export async function isShopInstalled(shopDomain: string): Promise<boolean> {
  if (!shopDomain) return false;
  const row = await prisma.session.findFirst({
    where: { shop: shopDomain },
    select: { id: true },
  });
  return row !== null;
}

export function newMessageId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return `m-${globalThis.crypto.randomUUID()}`;
  }
  return `m-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
