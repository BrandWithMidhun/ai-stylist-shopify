import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { generateTagsForProductById } from "../lib/catalog/ai-tagger.server";

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const id = params.id;
  if (!id) {
    return Response.json({ ok: false, error: "missing_id" }, { status: 400 });
  }

  const result = await generateTagsForProductById({
    shopDomain: session.shop,
    productId: id,
  });

  if (!result.ok) {
    return Response.json({ ok: false, error: result.error }, { status: 400 });
  }

  return Response.json({
    ok: true,
    tags: result.tags,
    writtenCount: result.writtenCount,
  });
};

export const loader = () => {
  return Response.json({ error: "method_not_allowed" }, { status: 405 });
};
