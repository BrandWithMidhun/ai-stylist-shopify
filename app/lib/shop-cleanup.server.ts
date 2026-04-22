import prisma from "../db.server";

export type ShopCleanupTask = {
  name: string;
  deleteFn: (shop: string) => Promise<{ count: number }>;
};

export const SHOP_CLEANUP_TASKS: ShopCleanupTask[] = [
  {
    name: "session",
    deleteFn: (shop) => prisma.session.deleteMany({ where: { shop } }),
  },
  {
    name: "merchantConfig",
    deleteFn: (shop) => prisma.merchantConfig.deleteMany({ where: { shop } }),
  },
];

export async function runShopCleanup(
  shop: string,
): Promise<Record<string, number>> {
  const results: Record<string, number> = {};

  for (const task of SHOP_CLEANUP_TASKS) {
    try {
      const { count } = await task.deleteFn(shop);
      results[task.name] = count;
    } catch (error) {
      results[task.name] = 0;
      console.error(
        `Shop cleanup task "${task.name}" failed for ${shop}:`,
        error,
      );
    }
  }

  return results;
}
