// Auxiliary probe: what fit values do the kurta products carry?
// Specifically: what does the OTHER AI-tagged kurta product (the one that
// didn't survive Stage 2's top-50) carry on fit?
// Output is printed to stdout.

import "dotenv/config";
import prisma from "../app/db.server";

const SHOP = "ai-fashion-store.myshopify.com";

async function main(): Promise<void> {
  // All AI-tagged kurta products in the shop.
  const aiKurtaTags = await prisma.productTag.findMany({
    where: {
      shopDomain: SHOP,
      status: "APPROVED",
      axis: "category",
      value: "kurta",
      source: "AI",
    },
    select: { productId: true },
  });
  const aiKurtaIds = aiKurtaTags.map((r) => r.productId);
  console.log(`AI-tagged kurta product IDs: ${JSON.stringify(aiKurtaIds)}`);

  // For each AI-tagged kurta product, what fit values do they carry?
  const fitTags = await prisma.productTag.findMany({
    where: {
      shopDomain: SHOP,
      status: "APPROVED",
      axis: "fit",
      productId: { in: aiKurtaIds },
    },
    select: { productId: true, value: true },
  });
  console.log(`AI-tagged kurta fit tags: ${JSON.stringify(fitTags)}`);

  // What products carry fit=oversized OR fit=relaxed (the values the fixture expects)?
  const oversizedRelaxedFitTags = await prisma.productTag.findMany({
    where: {
      shopDomain: SHOP,
      status: "APPROVED",
      axis: "fit",
      value: { in: ["oversized", "relaxed"] },
    },
    select: { productId: true, value: true },
  });
  console.log(`Catalog-wide products with fit=oversized OR relaxed: ${oversizedRelaxedFitTags.length}`);
  oversizedRelaxedFitTags.forEach((r) => console.log(`  productId=${r.productId} fit=${r.value}`));

  // Intersection: AI-tagged kurta products with fit=oversized OR fit=relaxed?
  const kurtaOversizedRelaxed = oversizedRelaxedFitTags.filter((r) =>
    aiKurtaIds.includes(r.productId),
  );
  console.log(`Intersection (kurta AI + fit IN {oversized,relaxed}): ${kurtaOversizedRelaxed.length}`);

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
