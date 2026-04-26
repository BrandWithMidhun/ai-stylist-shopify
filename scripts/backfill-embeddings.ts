// CLI entry point for embedding backfill. Runs locally against any DB
// pointed at by DATABASE_URL (dev or prod-via-tunnel) and on Railway as
// a one-shot or cron task once 12b.5 wires it up.
//
// Usage:
//   tsx scripts/backfill-embeddings.ts
//   tsx scripts/backfill-embeddings.ts --shop=ai-fashion-store.myshopify.com
//   tsx scripts/backfill-embeddings.ts --force
//
// Exit code: 0 if zero failures across all shops; 1 if any shop reported
// a non-zero `failed` count. Surfaces cleanly to CI/cron exit signaling.

import {
  embedAllShops,
  embedProductsForShop,
  type EmbedResult,
} from "../app/lib/embeddings/embed-products.server";

type Args = {
  shop: string | undefined;
  force: boolean;
};

function parseArgs(): Args {
  const args = process.argv.slice(2);
  let shop: string | undefined;
  let force = false;
  for (const arg of args) {
    if (arg.startsWith("--shop=")) {
      shop = arg.slice("--shop=".length).trim();
      if (!shop) {
        // eslint-disable-next-line no-console
        console.error("--shop= requires a value (e.g. --shop=foo.myshopify.com)");
        process.exit(2);
      }
    } else if (arg === "--force") {
      force = true;
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      // eslint-disable-next-line no-console
      console.error(`Unknown argument: ${arg}`);
      printHelp();
      process.exit(2);
    }
  }
  return { shop, force };
}

function printHelp(): void {
  // eslint-disable-next-line no-console
  console.log(
    [
      "Usage: tsx scripts/backfill-embeddings.ts [--shop=DOMAIN] [--force]",
      "",
      "  Without --shop, embeds products for every shop in the Product table.",
      "  --force re-embeds rows even if their embeddingUpdatedAt is current.",
    ].join("\n"),
  );
}

function formatLine(r: EmbedResult): string {
  const seconds = (r.durationMs / 1000).toFixed(1);
  return `[${r.shopDomain}] processed=${r.processed} succeeded=${r.succeeded} failed=${r.failed} skipped=${r.skippedUpToDate} duration=${seconds}s`;
}

async function main(): Promise<void> {
  const { shop, force } = parseArgs();

  const results: EmbedResult[] = shop
    ? [await embedProductsForShop(shop, { force })]
    : await embedAllShops({ force });

  // eslint-disable-next-line no-console
  console.log("");
  for (const r of results) {
    // eslint-disable-next-line no-console
    console.log(formatLine(r));
  }

  const totals = results.reduce(
    (acc, r) => {
      acc.processed += r.processed;
      acc.succeeded += r.succeeded;
      acc.failed += r.failed;
      acc.skipped += r.skippedUpToDate;
      acc.durationMs += r.durationMs;
      return acc;
    },
    { processed: 0, succeeded: 0, failed: 0, skipped: 0, durationMs: 0 },
  );
  const totalSeconds = (totals.durationMs / 1000).toFixed(1);
  // eslint-disable-next-line no-console
  console.log(
    `[TOTAL] shops=${results.length} processed=${totals.processed} succeeded=${totals.succeeded} failed=${totals.failed} skipped=${totals.skipped} duration=${totalSeconds}s`,
  );

  process.exit(totals.failed > 0 ? 1 : 0);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("[backfill-embeddings] fatal:", err);
  process.exit(1);
});
