import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { runShopCleanup } from "../lib/shop-cleanup.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await authenticate.webhook(request);

  const cleanupResult = await runShopCleanup(shop);

  console.log(
    `[gdpr] ${topic} for ${shop} — cleanup=${JSON.stringify(cleanupResult)}`,
  );

  return new Response();
};
