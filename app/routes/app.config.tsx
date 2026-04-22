import { useEffect, useState } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { Form, useActionData, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import {
  CTA_LABEL_MAX,
  type CtaPlacement,
  type StoreMode,
} from "../lib/merchant-config";
import {
  defaultMerchantConfig,
  getMerchantConfig,
  parseFormData,
  upsertMerchantConfig,
} from "../lib/merchant-config.server";

const STORE_MODE_OPTIONS: { value: StoreMode; label: string }[] = [
  { value: "FASHION", label: "Fashion" },
  { value: "ELECTRONICS", label: "Electronics" },
  { value: "FURNITURE", label: "Furniture" },
  { value: "BEAUTY", label: "Beauty" },
  { value: "GENERAL", label: "General commerce" },
];

const CTA_PLACEMENT_OPTIONS: { value: CtaPlacement; label: string }[] = [
  { value: "PRODUCT_PAGE", label: "Product page" },
  { value: "GLOBAL", label: "Global (site-wide)" },
  { value: "COLLECTION", label: "Collection pages" },
];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const existing = await getMerchantConfig(session.shop);
  const config = existing ?? defaultMerchantConfig(session.shop);
  return {
    config,
    isPersisted: existing !== null,
    version: existing?.updatedAt.toISOString() ?? "default",
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  try {
    const input = parseFormData(formData);
    await upsertMerchantConfig(session.shop, input);
    return { ok: true as const };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Could not save configuration.";
    return { ok: false as const, error: message };
  }
};

export default function ConfigPage() {
  const { config, version } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const shopify = useAppBridge();

  const [storeMode, setStoreMode] = useState<StoreMode>(
    config.storeMode as StoreMode,
  );
  const [ctaLabel, setCtaLabel] = useState<string>(config.ctaLabel);
  const fashionOnlyLocked = storeMode !== "FASHION";

  useEffect(() => {
    if (!actionData) return;
    if (actionData.ok) {
      shopify.toast.show("Configuration saved");
    } else {
      shopify.toast.show(actionData.error, { isError: true });
    }
  }, [actionData, shopify]);

  return (
    <s-page heading="Configuration">
      <Form key={version} method="post" data-save-bar="true">
        <s-section heading="Store type">
          <s-paragraph>
            Choose the vertical that best matches your catalog. This shapes
            recommendations, the quiz, and available features.
          </s-paragraph>
          <s-select
            label="Store mode"
            name="storeMode"
            value={storeMode}
            onChange={(event: Event) => {
              const target = event.currentTarget as HTMLSelectElement;
              setStoreMode(target.value as StoreMode);
            }}
          >
            {STORE_MODE_OPTIONS.map((option) => (
              <s-option key={option.value} value={option.value}>
                {option.label}
              </s-option>
            ))}
          </s-select>
        </s-section>

        <s-section heading="Features">
          <s-stack direction="block" gap="base">
            <s-switch
              label="Chat widget"
              name="chatWidgetEnabled"
              value="true"
              details="Show the AI shopping assistant on your storefront."
              {...(config.chatWidgetEnabled ? { checked: true } : {})}
            />
            <s-switch
              label="Onboarding quiz"
              name="quizEnabled"
              value="true"
              details="Ask shoppers a few questions inside the chat to personalize recommendations."
              {...(config.quizEnabled ? { checked: true } : {})}
            />
            <s-switch
              label="Stylist agent"
              name="stylistAgentEnabled"
              value="true"
              details={
                fashionOnlyLocked
                  ? "Stylist agent is a fashion-only feature. Switch store mode to Fashion to enable it."
                  : "Enable the styling agent for outfit and look suggestions."
              }
              {...(config.stylistAgentEnabled ? { checked: true } : {})}
              {...(fashionOnlyLocked ? { disabled: true } : {})}
            />
            <s-switch
              label="Commerce agent"
              name="commerceAgentEnabled"
              value="true"
              details="Enable the commerce agent to add items to cart and assist with checkout."
              {...(config.commerceAgentEnabled ? { checked: true } : {})}
            />
            <s-switch
              label="Lookbook"
              name="lookbookEnabled"
              value="true"
              details={
                fashionOnlyLocked
                  ? "Lookbook is a fashion-only feature. Switch store mode to Fashion to enable it."
                  : "Auto-generate shoppable lookbooks from your catalog."
              }
              {...(config.lookbookEnabled ? { checked: true } : {})}
              {...(fashionOnlyLocked ? { disabled: true } : {})}
            />
          </s-stack>
        </s-section>

        <s-section heading="CTA configuration">
          <s-paragraph>
            The CTA is the small call-to-action shown near Add to Cart that
            invites shoppers to chat with the assistant.
          </s-paragraph>
          <s-stack direction="block" gap="base">
            <s-switch
              label="Show CTA"
              name="ctaEnabled"
              value="true"
              details="Turn the CTA on or off without changing its label or placement."
              {...(config.ctaEnabled ? { checked: true } : {})}
            />
            <s-text-field
              label="CTA label"
              name="ctaLabel"
              value={ctaLabel}
              max-length={CTA_LABEL_MAX}
              details={`${ctaLabel.length}/${CTA_LABEL_MAX} characters`}
              required
              onInput={(event: Event) => {
                const target = event.currentTarget as HTMLInputElement;
                setCtaLabel(target.value);
              }}
            />
            <s-select
              label="CTA placement"
              name="ctaPlacement"
              value={config.ctaPlacement}
            >
              {CTA_PLACEMENT_OPTIONS.map((option) => (
                <s-option key={option.value} value={option.value}>
                  {option.label}
                </s-option>
              ))}
            </s-select>
          </s-stack>
        </s-section>

      </Form>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
