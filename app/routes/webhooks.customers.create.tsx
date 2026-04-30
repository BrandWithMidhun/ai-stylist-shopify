import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

// PR-C log-only stub. PR-D wires CustomerProfile schema + real customer
// write logic. Extend this handler when CustomerProfile lands:
//   - upsert CustomerProfile by (shop, shopifyCustomerId)
//   - hydrate CustomerProfileAttribute rows from payload + mode schema
//   - reconcile any anonymous CustomerSession matched on email
// For now: HMAC-validated, structured-logged, 200 returned. Subscribing
// during PR-C ensures we don't drop deliveries between PR-C and PR-D.

type CustomerPayload = { id?: number | string };

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);
  const webhookId = request.headers.get("x-shopify-webhook-id") ?? "unknown";
  const body = (payload ?? {}) as CustomerPayload & Record<string, unknown>;
  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify({
      event: "customer_webhook_received",
      topic,
      shop,
      webhookId,
      customerId: body.id ?? null,
      payloadKeys: Object.keys(body),
      pendingHandler: "PR-D",
    }),
  );
  return new Response();
};
