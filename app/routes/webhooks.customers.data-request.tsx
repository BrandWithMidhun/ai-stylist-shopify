import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

type DataRequestPayload = {
  customer?: { id?: number | string };
  data_request?: { id?: number | string };
  orders_requested?: unknown[];
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);
  const body = payload as DataRequestPayload;

  const dataRequestId = body.data_request?.id ?? "unknown";
  const customerId = body.customer?.id ?? "unknown";
  const ordersRequested = body.orders_requested?.length ?? 0;

  console.log(
    `[gdpr] ${topic} for ${shop} — data_request_id=${dataRequestId} customer_id=${customerId} orders_requested=${ordersRequested}`,
  );

  return new Response();
};
