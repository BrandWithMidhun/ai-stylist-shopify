import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

type CustomersRedactPayload = {
  customer?: { id?: number | string };
  orders_to_redact?: unknown[];
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);
  const body = payload as CustomersRedactPayload;

  const customerId = body.customer?.id ?? "unknown";
  const ordersToRedact = body.orders_to_redact?.length ?? 0;

  console.log(
    `[gdpr] ${topic} for ${shop} — customer_id=${customerId} orders_to_redact=${ordersToRedact}`,
  );

  return new Response();
};
