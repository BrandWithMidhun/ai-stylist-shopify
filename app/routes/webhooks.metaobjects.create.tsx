import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

// Phase 1 (PR-C) — C.1 skeleton. C.2 replaces the body with
// enqueueDeltaForShop + (for update/delete) bumpHashForMetaobjectReferents
// to fan out hash invalidation to every product that references the
// metaobject via a metafield reference.

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await authenticate.webhook(request);
  const webhookId = request.headers.get("x-shopify-webhook-id") ?? "unknown";
  // eslint-disable-next-line no-console
  console.log(
    `[webhook:c1-skeleton] topic=${topic} shop=${shop} webhookId=${webhookId}`,
  );
  return new Response();
};
