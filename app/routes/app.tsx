import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";

import { authenticate } from "../shopify.server";
import { ensureMerchantConfig } from "../lib/merchant-config.server";
import { syncChatConfigMetafield } from "../lib/chat/metafield-sync.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  // Chokepoint for every nested /app/* route. Guarantees MerchantConfig row
  // exists so downstream loaders/actions can assume it.
  const config = await ensureMerchantConfig(session.shop);

  // First-render guarantee for the storefront: the chat config metafield
  // must exist before the widget loads on a customer's browser. The
  // metafieldsSet mutation upserts (idempotent on subsequent calls), so
  // running this on every /app/* load is cheap and self-healing — if a
  // prior write failed (missing scope, transient error), the next visit
  // catches it. Failures are logged but never block the merchant from
  // reaching the admin UI; e.g., immediately after the scope expansion
  // deploys, the merchant lands here without the new write_app_metafields
  // grant and we want them to see the re-auth banner.
  try {
    await syncChatConfigMetafield(admin, config);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(
      `[app loader] metafield sync skipped for ${session.shop}:`,
      err,
    );
  }

  // eslint-disable-next-line no-undef
  return { apiKey: process.env.SHOPIFY_API_KEY || "" };
};

export default function App() {
  const { apiKey } = useLoaderData<typeof loader>();

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
