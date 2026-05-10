// mech.2.5 verification probe: invokes the v2 pipeline directly against
// each of the 12 fixture files, captures the full ProductCard[] output
// per fixture, and dumps to JSON. The eval harness's RealPipelineRunner
// projects ProductCards into {handle, tags} only (see
// pipeline-runner.server.ts lines 33-43), so it cannot verify mech.2's
// variant-loading wire. This probe captures variantId, compareAtPrice,
// available, price per card so op debt #15's "Add-to-Cart appears with
// real variant data" claim is programmatically verifiable.
//
// Reads fixture files directly from disk (NOT via prisma.evalQuery) so
// the probe exercises the canonical JSON fixtures, not whatever
// eval-fixtures-sync last wrote into the DB.
//
// One-shot probe — lives under .pr-3-1-7-mech-2-artifacts/ (NOT planning-
// artifacts) because it's mech.2.5-scope only. Future mechs author their
// own end-to-end probes (or extract this to a shared helper if a third
// caller appears, mirroring v1 extractNumericId's deferred-hoist pattern).
//
// Per-fixture errors are caught and recorded — one bad fixture must not
// abort the run (mirrors runner.server.ts:78-103).
//
// Run via:
//   npx tsx --env-file=.env .pr-3-1-7-mech-2-artifacts/probe-pipeline-end-to-end.ts
//   npx tsx --env-file=.env .pr-3-1-7-mech-2-artifacts/probe-pipeline-end-to-end.ts --out=.pr-3-1-7-mech-2-artifacts/02-pipeline-end-to-end-post-mech-2.json

import "dotenv/config";
import * as fs from "node:fs";
import * as path from "node:path";

import prisma from "../app/db.server";
import { runPipeline } from "../app/lib/recommendations/v2/pipeline.server";
import { embedQuery as voyageEmbedQuery } from "../app/lib/embeddings/voyage.server";

const SHOP = "ai-fashion-store.myshopify.com";
const FIXTURE_DIR = path.join(
  process.cwd(),
  "app",
  "lib",
  "recommendations",
  "v2",
  "eval",
  "fixtures",
);
const DEFAULT_OUT_PATH = path.join(
  process.cwd(),
  ".pr-3-1-7-mech-2-artifacts",
  "02-pipeline-end-to-end-post-mech-2.json",
);

function parseOutPath(): string {
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith("--out=")) {
      const v = arg.slice("--out=".length).trim();
      if (v) return path.isAbsolute(v) ? v : path.join(process.cwd(), v);
    }
  }
  return DEFAULT_OUT_PATH;
}

type Fixture = {
  fixtureKey: string;
  intent: string;
  k?: number;
  expectedHandles?: string[];
};

async function main(): Promise<void> {
  const files = fs
    .readdirSync(FIXTURE_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort();

  const out: Array<Record<string, unknown>> = [];
  for (const file of files) {
    const fixturePath = path.join(FIXTURE_DIR, file);
    const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf-8")) as Fixture;
    const k = fixture.k ?? 6;

    const startMs = Date.now();
    try {
      const result = await runPipeline(
        { shopDomain: SHOP, intent: fixture.intent, limit: k },
        { prisma, embedQuery: voyageEmbedQuery },
      );

      // Extract Stage 5.5 contribution from the trace for variant-load
      // wall-clock cost. Mirrors how mech.1.5's analysis extracted
      // per-stage timing.
      const stage55 = result.trace.stages.find(
        (s) => s.name === "stage-5.5-variant-load",
      );

      out.push({
        fixtureKey: fixture.fixtureKey,
        intent: fixture.intent,
        productCount: result.products.length,
        products: result.products.map((p) => ({
          handle: p.handle,
          title: p.title,
          price: p.price,
          compareAtPrice: p.compareAtPrice,
          currency: p.currency,
          variantId: p.variantId,
          available: p.available,
        })),
        stage55: stage55
          ? {
              ms: stage55.ms,
              candidatesIn: stage55.candidatesIn,
              candidatesOut: stage55.candidatesOut,
              meta: stage55.meta,
            }
          : null,
        totalMs: result.totalMs,
        topDistance: result.topDistance,
      });
    } catch (err) {
      out.push({
        fixtureKey: fixture.fixtureKey,
        intent: fixture.intent,
        error: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - startMs,
      });
    }
  }

  const outPath = parseOutPath();
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2), "utf-8");
  // eslint-disable-next-line no-undef, no-console
  console.log(`Wrote ${outPath} (${out.length} fixtures).`);
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-undef, no-console
    console.error(err);
    // eslint-disable-next-line no-undef
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
