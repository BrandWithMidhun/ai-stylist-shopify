import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

type ProductDeletePayload = { id?: number | string };

// Spec 4.3:
//   - soft-delete Product (set deletedAt)
//   - cascade-delete ProductTags
//   - hard-delete ProductVariants (per execution decision 7)
//   - keep ProductTagAudit intact
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);

  const config = await prisma.merchantConfig.findUnique({
    where: { shop },
    select: { lastFullSyncAt: true },
  });
  if (!config?.lastFullSyncAt) {
    console.log(
      `[webhook] ignoring ${topic} for ${shop} — no initial sync yet`,
    );
    return new Response();
  }

  const body = payload as ProductDeletePayload;
  if (body.id === undefined || body.id === null) {
    console.log(`[webhook] ${topic} for ${shop} missing id — ignoring`);
    return new Response();
  }

  const shopifyGid = `gid://shopify/Product/${String(body.id)}`;

  const product = await prisma.product.findUnique({
    where: {
      shopDomain_shopifyId: { shopDomain: shop, shopifyId: shopifyGid },
    },
    select: { id: true },
  });

  if (!product) {
    console.log(
      `[webhook] ${topic} for ${shop} product ${shopifyGid} not in local DB — ignoring`,
    );
    return new Response();
  }

  await prisma.$transaction([
    prisma.productTag.deleteMany({ where: { productId: product.id } }),
    prisma.productVariant.deleteMany({ where: { productId: product.id } }),
    prisma.product.update({
      where: { id: product.id },
      data: { deletedAt: new Date() },
    }),
  ]);

  return new Response();
};
