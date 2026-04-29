import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

// Phase 1 (PR-C) — C.1 skeleton.
//
// PR-C ships customers/* as LOG-ONLY stubs (per Q1 in PR-C planning).
// PR-D introduces the CustomerProfile schema and replaces this body with
// real upsert logic. Subscribing now ensures we don't lose the
// customers/create deliveries between PR-C deploy and PR-D ship.
//
// PR-D author: this is where the real CustomerProfile upsert hooks in.
// Read shop + payload (customer.id, email, etc.) and call the
// CustomerProfile creator from PR-D's library.

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await authenticate.webhook(request);
  const webhookId = request.headers.get("x-shopify-webhook-id") ?? "unknown";
  // eslint-disable-next-line no-console
  console.log(
    `[webhook:c1-skeleton] topic=${topic} shop=${shop} webhookId=${webhookId}`,
  );
  return new Response();
};
