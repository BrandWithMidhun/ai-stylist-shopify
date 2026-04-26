// Tool registry — single seam between the orchestrator and individual tools.
//
// Adding a new tool (e.g. stylist for 010, lookbook for 014) is two lines:
//   1. import its definition + executor
//   2. add a case to executeTool's switch and (optionally) gate inclusion in
//      buildToolList by config flag (e.g. config.stylistAgentEnabled)
//
// agent.server.ts never imports individual tools — only this module.

import type { MerchantConfig } from "@prisma/client";
import {
  recommendProducts,
  recommendProductsTool,
} from "./recommend-products.server";
import { searchProducts, searchProductsTool } from "./search-products.server";
import type { ToolDef, ToolExecutionContext, ToolResult } from "./types";

export function buildToolList(config: MerchantConfig): ToolDef[] {
  // Phase 1: commerce only. recommend_products + search_products are
  // universal across storeModes. 010 will conditionally append the
  // stylist tool when storeMode is FASHION or JEWELLERY and
  // config.stylistAgentEnabled is true. 014 adds lookbook.
  //
  // Order matters: recommend_products is listed first so Claude prefers
  // it for ambiguous "help me browse" requests where semantic similarity
  // beats keyword matching. search_products stays available for explicit
  // attribute lookups.
  void config;
  return [recommendProductsTool, searchProductsTool];
}

export async function executeTool(
  name: string,
  input: unknown,
  ctx: ToolExecutionContext,
): Promise<ToolResult> {
  switch (name) {
    case "recommend_products":
      return recommendProducts(
        input as Parameters<typeof recommendProducts>[0],
        ctx,
      );
    case "search_products":
      return searchProducts(input as Parameters<typeof searchProducts>[0], ctx);
    default:
      return {
        ok: false,
        data: { error: `unknown_tool: ${name}` },
      };
  }
}
