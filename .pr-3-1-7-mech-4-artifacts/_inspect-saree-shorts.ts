import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
const SHOP = 'ai-fashion-store.myshopify.com';
async function main() {
  const sareeRows = await prisma.product.findMany({
    where: {
      shopDomain: SHOP, status: 'ACTIVE', deletedAt: null,
      OR: [
        { title: { contains: 'saree', mode: 'insensitive' } },
        { title: { contains: 'sari', mode: 'insensitive' } },
        { productType: { contains: 'saree', mode: 'insensitive' } },
      ],
    },
    select: { id: true, handle: true, title: true, productType: true },
    take: 20,
  });
  console.log('Saree-ish products:');
  for (const p of sareeRows) console.log(' ', p.handle, '|', p.title, '|', p.productType);
  console.log('Total saree-ish (capped 20):', sareeRows.length);

  const shortsRows = await prisma.product.findMany({
    where: {
      shopDomain: SHOP, status: 'ACTIVE', deletedAt: null,
      OR: [
        { title: { contains: 'shorts', mode: 'insensitive' } },
        { productType: { contains: 'shorts', mode: 'insensitive' } },
      ],
    },
    select: { id: true, handle: true, title: true, productType: true },
    take: 20,
  });
  console.log('Shorts-ish products:');
  for (const p of shortsRows) console.log(' ', p.handle, '|', p.title, '|', p.productType);
  console.log('Total shorts-ish (capped 20):', shortsRows.length);

  const sareeCategoryRows = await prisma.productTag.findMany({
    where: { shopDomain: SHOP, axis: 'category', value: 'saree' },
    select: { productId: true, status: true, source: true, confidence: true },
  });
  const shortsCategoryRows = await prisma.productTag.findMany({
    where: { shopDomain: SHOP, axis: 'category', value: 'shorts' },
    select: { productId: true, status: true, source: true, confidence: true },
  });
  console.log('\nExisting category=saree rows:', sareeCategoryRows.length);
  for (const r of sareeCategoryRows) console.log(' ', r.status, '|', r.source, '|', r.confidence);
  console.log('Existing category=shorts rows:', shortsCategoryRows.length);
  for (const r of shortsCategoryRows) console.log(' ', r.status, '|', r.source, '|', r.confidence);

  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });