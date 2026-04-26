// Tool registry — single seam between the orchestrator and individual tools.
//
// Adding a new tool (e.g. stylist for 010, lookbook for 014) is two lines:
//   1. import its definition + executor
//   2. add a case to executeTool's switch and (optionally) gate inclusion in
//      buildToolList by config flag (e.g. config.stylistAgentEnabled)
//
// agent.server.ts never imports individual tools — only this module.

import type { MerchantConfig } from "@prisma/client";
import { searchProducts, searchProductsTool } from "./search-products.server";
import type { ToolDef, ToolExecutionContext, ToolResult } from "./types";

export function buildToolList(config: MerchantConfig): ToolDef[] {
  // Phase 1: commerce only. search_products is universal across storeModes.
  // 010 will conditionally append the stylist tool when storeMode is FASHION
  // or JEWELLERY and config.stylistAgentEnabled is true. 014 adds lookbook.
  void config;
  return [searchProductsTool];
}

export async function executeTool(
  name: string,
  input: unknown,
  ctx: ToolExecutionContext,
): Promise<ToolResult> {
  switch (name) {
    case "search_products":
      return searchProducts(input as Parameters<typeof searchProducts>[0], ctx);
    default:
      return {
        ok: false,
        data: { error: `unknown_tool: ${name}` },
      };
  }
}
