import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

// Phase 1 (PR-C) — C.1 skeleton.
//
// PR-C ships orders/* as LOG-ONLY stubs. Phase 3 builds the order
// ingest pipeline + AI revenue attribution. Subscribing now ensures we
// don't lose orders/create deliveries between PR-C deploy and Phase 3
// ship — and orders are exactly the deliveries we cannot replay (no
// merchant want a "bulk-replay 30 days of orders" tool the first time
// attribution lights up).

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await authenticate.webhook(request);
  const webhookId = request.headers.get("x-shopify-webhook-id") ?? "unknown";
  // eslint-disable-next-line no-console
  console.log(
    `[webhook:c1-skeleton] topic=${topic} shop=${shop} webhookId=${webhookId}`,
  );
  return new Response();
};
