import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";

import { authenticate } from "../shopify.server";
import { ensureMerchantConfig } from "../lib/merchant-config.server";
import { syncChatConfigMetafield } from "../lib/chat/metafield-sync.server";
import { EXPECTED_SCOPES, needsReauth } from "../lib/needs-reauth";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  // Chokepoint for every nested /app/* route. Guarantees MerchantConfig row
  // exists so downstream loaders/actions can assume it.
  const config = await ensureMerchantConfig(session.shop);

  // First-render guarantee for the storefront: the chat config metafield
  // must exist before the widget loads on a customer's browser. The
  // metafieldsSet mutation upserts (idempotent on subsequent calls), so
  // running this on every /app/* load is cheap and self-healing — if a
  // prior write failed (transient error), the next visit catches it.
  // Failures are logged but never block the merchant from reaching the
  // admin UI.
  try {
    await syncChatConfigMetafield(admin, config);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(
      `[app loader] metafield sync skipped for ${session.shop}:`,
      err,
    );
  }

  // PR-C C.3: scope-mismatch detection. session.scope is what the
  // merchant currently has granted; EXPECTED_SCOPES is what the app
  // declares. If any expected scope is missing, render a re-auth banner.
  const reauthRequired = needsReauth(session.scope, EXPECTED_SCOPES);

  return {
    // eslint-disable-next-line no-undef
    apiKey: process.env.SHOPIFY_API_KEY || "",
    reauthRequired,
  };
};

export default function App() {
  const { apiKey, reauthRequired } = useLoaderData<typeof loader>();

  return (
    <AppProvider embedded apiKey={apiKey}>
      <s-app-nav>
        <s-link href="/app/config">Configuration</s-link>
        <s-link href="/app/products/intelligence">Products</s-link>
        <s-link href="/app/intelligence/taxonomy">Taxonomy</s-link>
        <s-link href="/app/intelligence/rules">Rules</s-link>
        <s-link href="/app/ai-test">AI test</s-link>
        <s-link href="/app">Starter demo</s-link>
        <s-link href="/app/additional">Additional page</s-link>
      </s-app-nav>
      {reauthRequired ? (
        <s-banner tone="warning" heading="Reauthorization required">
          <s-paragraph>
            This app needs additional permissions to function correctly.
            Please reinstall to continue.
          </s-paragraph>
          <s-button slot="primary-action" href="/auth/login">
            Reauthorize
          </s-button>
        </s-banner>
      ) : null}
      <Outlet />
    </AppProvider>
  );
}

// Shopify needs React Router to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
