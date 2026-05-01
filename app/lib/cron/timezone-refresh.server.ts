// PR-D D.2: refresh MerchantConfig.timezone from Shopify shop.ianaTimezone.
//
// Refresh policy: cron-tick calls this at most once per shop per day —
// only when timezoneSyncedAt is null or older than 24h. Failure path
// preserves the existing timezone value (or "UTC" default if unset);
// next tick retries.

import type { PrismaClient } from "@prisma/client";
import { unauthenticated } from "../../shopify.server";
import {
  SHOP_TIMEZONE_QUERY,
  type ShopTimezoneResponse,
} from "../catalog/queries/shop.server";
import { log } from "../../server/worker-logger";

export type TimezoneRefreshResult = {
  shopDomain: string;
  ianaTimezone: string | null;
  changed: boolean;
  error?: string;
};

export async function refreshShopTimezone(
  shopDomain: string,
  prisma: PrismaClient,
): Promise<TimezoneRefreshResult> {
  try {
    const { admin } = await unauthenticated.admin(shopDomain);
    const response = await admin.graphql(SHOP_TIMEZONE_QUERY);
    const json = (await response.json()) as ShopTimezoneResponse;
    const ianaTimezone = json.data?.shop?.ianaTimezone ?? null;
    if (!ianaTimezone) {
      log.warn("timezone refresh: empty ianaTimezone", { shopDomain });
      // Stamp the syncedAt anyway so we don't retry every tick on a
      // shop that returns null for whatever reason.
      await prisma.merchantConfig.update({
        where: { shop: shopDomain },
        data: { timezoneSyncedAt: new Date() },
      });
      return { shopDomain, ianaTimezone: null, changed: false };
    }

    const existing = await prisma.merchantConfig.findUnique({
      where: { shop: shopDomain },
      select: { timezone: true },
    });
    const changed = existing?.timezone !== ianaTimezone;

    await prisma.merchantConfig.update({
      where: { shop: shopDomain },
      data: {
        timezone: ianaTimezone,
        timezoneSyncedAt: new Date(),
      },
    });

    if (changed) {
      log.info("timezone refreshed", {
        shopDomain,
        previous: existing?.timezone ?? null,
        ianaTimezone,
      });
    }
    return { shopDomain, ianaTimezone, changed };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn("timezone refresh failed", { shopDomain, message });
    return { shopDomain, ianaTimezone: null, changed: false, error: message };
  }
}
