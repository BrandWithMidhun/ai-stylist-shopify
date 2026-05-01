import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { upsertCustomerProfile } from "../lib/customers/upsert.server";

// PR-D D.1: thickened from log-only stub. Upserts CustomerProfile keyed
// on (shopDomain, shopifyCustomerId). Behavioral CustomerEvent rows are
// not emitted here (per A3/Q3: customer create/update is not a
// behavioral signal — it's an identity/attribute change).

type CustomerPayload = {
  id?: number | string;
  email?: string | null;
  phone?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  // Shopify uses shop_locale or just the customer's chosen locale on
  // the storefront — not always present. Pass through if available.
  locale?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

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
    const result = await upsertCustomerProfile({
      shopDomain: shop,
      shopifyCustomerId: customerId,
      email: body.email,
      phone: body.phone,
      firstName: body.first_name,
      lastName: body.last_name,
      locale: body.locale,
      shopifyCreatedAt: parseDate(body.created_at),
      shopifyUpdatedAt: parseDate(body.updated_at),
    });

    console.log(
      JSON.stringify({
        event: "customer_webhook_upserted",
        topic,
        shop,
        webhookId,
        customerId,
        profileId: result.id,
        created: result.created,
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
    // Return 200 anyway — Shopify will retry on non-2xx and the next
    // delivery will see the same shape; failing webhook delivery for a
    // transient DB error compounds the problem. Drift is recoverable
    // via PR-D's daily cron.
  }

  return new Response();
};
