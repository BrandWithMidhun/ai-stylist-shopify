// Single source of truth for storefront chat config: writes a JSON
// app-data metafield on the AppInstallation that the theme app extension
// reads via {{ app.metafields.ai_stylist.chat_config.value }}.
//
// NOTE: AppInstallation-owned metafields don't require any explicit access
// scopes — the AppInstallation owner provides automatic isolation, so only
// this app can read or write its own installation's metafields (per
// https://shopify.dev/docs/apps/build/metafields).
//
// Throws on Shopify errors (network, GraphQL, userErrors). Callers in the
// /app/config save path catch the throw, surface a toast, and let the
// Postgres save stand — the metafield will be backfilled on next save.

import type { MerchantConfig } from "@prisma/client";
import {
  getEffectiveAgentName,
  getEffectiveShopName,
} from "../merchant-config.server";
import type { StoreMode } from "../merchant-config";
import { getWelcomeMessage } from "./prompts.server";
import { getWelcomeChips } from "./suggestions.server";

const CURRENT_APP_INSTALLATION_QUERY = `#graphql
  query CurrentAppInstallationId {
    currentAppInstallation { id }
  }
`;

const METAFIELDS_SET_MUTATION = `#graphql
  mutation SetChatConfigMetafield($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      metafields { id namespace key }
      userErrors { field message code }
    }
  }
`;

// Bump if the payload shape changes — the storefront widget can fall back
// to defaults for older versions during a rolling deploy.
//
// version 2 (008 Phase 3): adds shopName, welcomeChips, and switches
// welcomeMessage to a mode-aware computed string (no longer raw DB value).
export const CHAT_CONFIG_METAFIELD_VERSION = 2;
export const CHAT_CONFIG_METAFIELD_NAMESPACE = "ai_stylist";
export const CHAT_CONFIG_METAFIELD_KEY = "chat_config";

export interface ChatConfigPayload {
  storeMode: string;
  agentName: string;
  shopName: string;
  primaryColor: string;
  welcomeMessage: string;
  welcomeChips: string[];
  chatWidgetEnabled: boolean;
  ctaEnabled: boolean;
  ctaLabel: string;
  stylistEnabled: boolean;
  lookbookEnabled: boolean;
  commerceEnabled: boolean;
  version: number;
}

export function buildChatConfigPayload(config: MerchantConfig): ChatConfigPayload {
  return {
    storeMode: config.storeMode,
    agentName: getEffectiveAgentName(config),
    shopName: getEffectiveShopName(config),
    primaryColor: config.chatPrimaryColor,
    welcomeMessage: getWelcomeMessage(config),
    welcomeChips: getWelcomeChips(config.storeMode as StoreMode),
    chatWidgetEnabled: config.chatWidgetEnabled,
    ctaEnabled: config.ctaEnabled,
    ctaLabel: config.ctaLabel,
    stylistEnabled: config.stylistAgentEnabled,
    lookbookEnabled: config.lookbookEnabled,
    commerceEnabled: config.commerceAgentEnabled,
    version: CHAT_CONFIG_METAFIELD_VERSION,
  };
}

interface AdminGraphqlClient {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
}

interface CurrentAppInstallationResponse {
  data?: { currentAppInstallation?: { id: string } | null };
  errors?: Array<{ message: string }>;
}

interface MetafieldsSetResponse {
  data?: {
    metafieldsSet?: {
      metafields: Array<{ id: string }> | null;
      userErrors: Array<{ field?: string[]; message: string; code?: string }>;
    };
  };
  errors?: Array<{ message: string }>;
}

export class MetafieldSyncError extends Error {
  readonly code: "graphql_error" | "user_error";
  constructor(code: MetafieldSyncError["code"], message: string) {
    super(message);
    this.code = code;
  }
}

export async function syncChatConfigMetafield(
  admin: AdminGraphqlClient,
  config: MerchantConfig,
): Promise<void> {
  const installationResponse = await admin.graphql(
    CURRENT_APP_INSTALLATION_QUERY,
  );
  const installationJson =
    (await installationResponse.json()) as CurrentAppInstallationResponse;

  if (installationJson.errors?.length) {
    const message = installationJson.errors.map((e) => e.message).join("; ");
    throw new MetafieldSyncError("graphql_error", message);
  }
  const ownerId = installationJson.data?.currentAppInstallation?.id;
  if (!ownerId) {
    throw new MetafieldSyncError(
      "graphql_error",
      "currentAppInstallation returned no id",
    );
  }

  const payload = buildChatConfigPayload(config);
  const setResponse = await admin.graphql(METAFIELDS_SET_MUTATION, {
    variables: {
      metafields: [
        {
          ownerId,
          namespace: CHAT_CONFIG_METAFIELD_NAMESPACE,
          key: CHAT_CONFIG_METAFIELD_KEY,
          type: "json",
          value: JSON.stringify(payload),
        },
      ],
    },
  });
  const setJson = (await setResponse.json()) as MetafieldsSetResponse;

  if (setJson.errors?.length) {
    const message = setJson.errors.map((e) => e.message).join("; ");
    throw new MetafieldSyncError("graphql_error", message);
  }
  const userErrors = setJson.data?.metafieldsSet?.userErrors ?? [];
  if (userErrors.length) {
    throw new MetafieldSyncError(
      "user_error",
      userErrors.map((e) => `${e.field?.join(".") ?? ""}: ${e.message}`).join("; "),
    );
  }
}
