import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { softDeleteCustomerProfile } from "../lib/customers/redact.server";

// PR-D D.1: thickened from log-only stub. customers/delete is
// functionally a redact for our purposes — same scrub semantics as
// customers/redact (PII nulled, attributes deleted, event context
// scrubbed, sessions detached). The two handlers share the
// softDeleteCustomerProfile helper.

type CustomerPayload = { id?: number | string };

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);
  const webhookId = request.headers.get("x-shopify-webhook-id") ?? "unknown";
  const body = (payload ?? {}) as CustomerPayload;
  const start = Date.now();

  const customerId = body.id != null ? String(body.id) : null;
  if (!customerId) {
    console.log(
      JSON.stringify({
        event: "customer_webhook_skipped",
        topic,
        shop,
        webhookId,
        reason: "missing_customer_id",
        durationMs: Date.now() - start,
      }),
    );
    return new Response();
  }

  try {
    const result = await softDeleteCustomerProfile(shop, customerId);
    console.log(
      JSON.stringify({
        event: "customer_webhook_redacted",
        topic,
        shop,
        webhookId,
        customerId,
        profileFound: result.profileFound,
        attributesDeleted: result.attributesDeleted,
        eventsScrubbed: result.eventsScrubbed,
        sessionsDetached: result.sessionsDetached,
        durationMs: Date.now() - start,
      }),
    );
  } catch (err) {
    console.error(
      JSON.stringify({
        event: "customer_webhook_failed",
        topic,
        shop,
        webhookId,
        customerId,
        message: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - start,
      }),
    );
  }

  return new Response();
};
