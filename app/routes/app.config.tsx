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
  CHAT_WELCOME_MESSAGE_MAX,
  CTA_LABEL_MAX,
  SHOP_DISPLAY_NAME_MAX,
  deriveShopNameFromDomain,
  getDefaultAgentName,
  type CtaPlacement,
  type StoreMode,
} from "../lib/merchant-config";
import {
  defaultMerchantConfig,
  getMerchantConfig,
  parseFormData,
  upsertMerchantConfig,
} from "../lib/merchant-config.server";
import { syncChatConfigMetafield } from "../lib/chat/metafield-sync.server";

const STORE_MODE_OPTIONS: { value: StoreMode; label: string }[] = [
  { value: "FASHION", label: "Fashion" },
  { value: "ELECTRONICS", label: "Electronics" },
  { value: "FURNITURE", label: "Furniture" },
  { value: "BEAUTY", label: "Beauty" },
  { value: "JEWELLERY", label: "Jewellery" },
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
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  let config;
  try {
    const input = parseFormData(formData);
    config = await upsertMerchantConfig(session.shop, input);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Could not save configuration.";
    return { ok: false as const, error: message };
  }

  // Postgres save succeeded — push to the storefront metafield. Failures
  // here surface a non-blocking warning: the merchant's data is safe, the
  // storefront just won't reflect this save until the next successful
  // sync.
  try {
    await syncChatConfigMetafield(admin, config);
    return { ok: true as const, syncWarning: null };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`[config] metafield sync failed for ${session.shop}:`, err);
    return {
      ok: true as const,
      syncWarning:
        "Saved to database. Storefront sync pending — try saving again in a moment.",
    };
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
  const [chatAgentName, setChatAgentName] = useState<string>(
    config.chatAgentName ?? "",
  );
  const [shopDisplayName, setShopDisplayName] = useState<string>(
    config.shopDisplayName ?? "",
  );
  const [chatPrimaryColor, setChatPrimaryColor] = useState<string>(
    config.chatPrimaryColor,
  );
  const [chatWelcomeMessage, setChatWelcomeMessage] = useState<string>(
    config.chatWelcomeMessage,
  );
  const fashionOnlyLocked = storeMode !== "FASHION";
  const agentNamePlaceholder = getDefaultAgentName(storeMode);
  const shopNamePlaceholder = deriveShopNameFromDomain(config.shop);

  useEffect(() => {
    if (!actionData) return;
    if (actionData.ok) {
      if (actionData.syncWarning) {
        shopify.toast.show(actionData.syncWarning, { isError: true });
      } else {
        shopify.toast.show("Configuration saved");
      }
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

        <s-section heading="Chat widget">
          <s-paragraph>
            These settings drive the storefront chat widget. Saving here
            pushes changes to your storefront immediately — the theme
            editor only needs the App Embed toggle enabled.
          </s-paragraph>
          <s-stack direction="block" gap="base">
            <s-text-field
              label="Agent name"
              name="chatAgentName"
              value={chatAgentName}
              placeholder={agentNamePlaceholder}
              details="Shown in the chat widget header. Leave blank to use the default for your store type."
              onInput={(event: Event) => {
                const target = event.currentTarget as HTMLInputElement;
                setChatAgentName(target.value);
              }}
            />
            <s-text-field
              label="Shop name (shown in chat)"
              name="shopDisplayName"
              value={shopDisplayName}
              placeholder={shopNamePlaceholder}
              max-length={SHOP_DISPLAY_NAME_MAX}
              details="How your shop is referred to in chat. Leave blank to use the auto-detected name."
              onInput={(event: Event) => {
                const target = event.currentTarget as HTMLInputElement;
                setShopDisplayName(target.value);
              }}
            />
            <s-color-field
              label="Primary color"
              name="chatPrimaryColor"
              value={chatPrimaryColor}
              details="Used for the chat bubble, send button, and message highlights."
              onChange={(event: Event) => {
                const target = event.currentTarget as HTMLInputElement;
                setChatPrimaryColor(target.value);
              }}
            />
            <s-text-area
              label="Welcome message"
              name="chatWelcomeMessage"
              value={chatWelcomeMessage}
              rows={3}
              max-length={CHAT_WELCOME_MESSAGE_MAX}
              required
              details={`${chatWelcomeMessage.length}/${CHAT_WELCOME_MESSAGE_MAX} characters. Shown as the first assistant bubble when a shopper opens the widget.`}
              onInput={(event: Event) => {
                const target = event.currentTarget as HTMLTextAreaElement;
                setChatWelcomeMessage(target.value);
              }}
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
