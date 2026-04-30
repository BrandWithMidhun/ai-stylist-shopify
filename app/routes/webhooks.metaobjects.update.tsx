import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

// Skeleton handler. Topic not subscribed in PR-C (Shopify requires a
// metaobject_type filter and the dev shop has zero metaobject
// definitions). Wire when real merchant onboarding adds metaobject
// types.

type MetaobjectPayload = { id?: number | string; type?: string };

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);
  const webhookId = request.headers.get("x-shopify-webhook-id") ?? "unknown";
  const body = (payload ?? {}) as MetaobjectPayload & Record<string, unknown>;
  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify({
      event: "metaobject_webhook_received",
      topic,
      shop,
      webhookId,
      metaobjectId: body.id ?? null,
      metaobjectType: body.type ?? null,
      payloadKeys: Object.keys(body),
      pendingHandler: "future-merchant-onboarding",
    }),
  );
  return new Response();
};
