import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { loadDashboardStats } from "../lib/catalog/stats.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const stats = await loadDashboardStats(session.shop);
  return Response.json(stats, {
    headers: { "Cache-Control": "private, max-age=0" },
  });
};
