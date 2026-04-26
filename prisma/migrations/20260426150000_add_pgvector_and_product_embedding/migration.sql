-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Add embedding columns to Product
ALTER TABLE "Product"
  ADD COLUMN "embedding" vector(1024),
  ADD COLUMN "embeddingUpdatedAt" TIMESTAMP(3);

-- Index for cosine-similarity search.
-- IVFFlat trades a small amount of recall for major speed gains on
-- catalogs in the 1k-10k product range. lists=100 is the right default;
-- revisit if catalogs grow much larger.
CREATE INDEX "Product_embedding_cosine_idx"
  ON "Product"
  USING ivfflat ("embedding" vector_cosine_ops)
  WITH (lists = 100);
