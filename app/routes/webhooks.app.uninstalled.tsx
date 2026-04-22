import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { runShopCleanup } from "../lib/shop-cleanup.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  const results = await runShopCleanup(shop);
  const summary = Object.entries(results)
    .map(([name, count]) => `${name}: ${count}`)
    .join(", ");
  console.log(`Uninstall cleanup for ${shop}: { ${summary} }`);

  return new Response();
};
