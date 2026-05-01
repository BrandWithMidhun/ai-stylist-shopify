import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { softDeleteCustomerProfile } from "../lib/customers/redact.server";

// GDPR mandatory webhook. Per A3/Q4: synchronous, in-transaction redact
// cascade. Sets CustomerProfile.deletedAt + nulls PII columns; deletes
// CustomerProfileAttribute rows; scrubs CustomerEvent.context PII keys;
// detaches CustomerSession.profileId. Returns 200 once the transaction
// commits — Shopify retries on non-2xx, and partial redaction is worse
// than retry-driven redaction for compliance.

type CustomersRedactPayload = {
  customer?: { id?: number | string };
  orders_to_redact?: unknown[];
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);
  const webhookId = request.headers.get("x-shopify-webhook-id") ?? "unknown";
  const body = payload as CustomersRedactPayload;
  const start = Date.now();

  const customerId =
    body.customer?.id != null ? String(body.customer.id) : null;
  const ordersToRedact = body.orders_to_redact?.length ?? 0;

  if (!customerId) {
    console.log(
      JSON.stringify({
        event: "gdpr_redact_skipped",
        topic,
        shop,
        webhookId,
        reason: "missing_customer_id",
        ordersToRedact,
        durationMs: Date.now() - start,
      }),
    );
    return new Response();
  }

  try {
    const result = await softDeleteCustomerProfile(shop, customerId);
    console.log(
      JSON.stringify({
        event: "gdpr_redact_completed",
        topic,
        shop,
        webhookId,
        customerId,
        ordersToRedact,
        profileFound: result.profileFound,
        attributesDeleted: result.attributesDeleted,
        eventsScrubbed: result.eventsScrubbed,
        sessionsDetached: result.sessionsDetached,
        durationMs: Date.now() - start,
      }),
    );
  } catch (err) {
    // GDPR webhooks must succeed eventually for compliance. Logging
    // structured + returning 200 (NOT throwing) so Shopify retry
    // doesn't loop on the same DB error indefinitely. If repeated
    // failures show up in logs, the redact must be re-driven manually.
    console.error(
      JSON.stringify({
        event: "gdpr_redact_failed",
        topic,
        shop,
        webhookId,
        customerId,
        ordersToRedact,
        message: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - start,
      }),
    );
  }

  return new Response();
};
