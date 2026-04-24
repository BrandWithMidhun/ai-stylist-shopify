import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useFetcher } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { callClaude, type CallClaudeResult } from "../lib/anthropic.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return null;
};

export const action = async ({
  request,
}: ActionFunctionArgs): Promise<CallClaudeResult> => {
  await authenticate.admin(request);
  const formData = await request.formData();
  const prompt = String(formData.get("prompt") ?? "");
  return callClaude(prompt);
};

export default function AiTestPage() {
  const fetcher = useFetcher<typeof action>();
  const isLoading =
    ["loading", "submitting"].includes(fetcher.state) &&
    fetcher.formMethod === "POST";
  const result = fetcher.data;

  return (
    <s-page heading="AI test">
      <s-section heading="Prompt">
        <s-paragraph>
          Send a prompt to Claude and see the raw response. This page is for
          development and testing the Anthropic API integration.
        </s-paragraph>
        <fetcher.Form method="post">
          <s-stack direction="block" gap="base">
            <s-text-area
              label="Prompt"
              name="prompt"
              rows={6}
              placeholder="Say hi in one sentence"
              required
            />
            <s-button
              type="submit"
              variant="primary"
              {...(isLoading ? { loading: true, disabled: true } : {})}
            >
              Send to Claude
            </s-button>
          </s-stack>
        </fetcher.Form>
      </s-section>

      <s-section heading="Response">
        {isLoading ? (
          <s-stack direction="inline" gap="base" alignItems="center">
            <s-spinner accessibilityLabel="Calling Claude" size="base" />
            <s-text>Calling Claude…</s-text>
          </s-stack>
        ) : result?.ok === true ? (
          <s-box
            padding="base"
            borderWidth="base"
            borderRadius="base"
            background="subdued"
          >
            <s-paragraph>{result.text}</s-paragraph>
          </s-box>
        ) : result?.ok === false ? (
          <s-banner tone="critical" heading="Claude request failed">
            <s-paragraph>{result.error}</s-paragraph>
          </s-banner>
        ) : (
          <s-text>No response yet. Submit a prompt to get started.</s-text>
        )}
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
