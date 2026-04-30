import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

// PR-C log-only stub. Phase 3 builds the order ingest pipeline.
// Extend this handler when ingest lands.

type OrderPayload = { id?: number | string };

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);
  const webhookId = request.headers.get("x-shopify-webhook-id") ?? "unknown";
  const body = (payload ?? {}) as OrderPayload & Record<string, unknown>;
  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify({
      event: "order_webhook_received",
      topic,
      shop,
      webhookId,
      orderId: body.id ?? null,
      payloadKeys: Object.keys(body),
      pendingHandler: "phase-3",
    }),
  );
  return new Response();
};
