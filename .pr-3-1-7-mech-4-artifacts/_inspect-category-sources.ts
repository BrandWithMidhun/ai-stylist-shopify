import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const grouped = await prisma.productTag.groupBy({
    by: ['source', 'status'],
    where: { shopDomain: 'ai-fashion-store.myshopify.com', axis: 'category' },
    _count: { _all: true },
  });
  console.log('category tag source x status:');
  for (const row of grouped) console.log(' ', row.source, '|', row.status, '|', row._count._all);
  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
