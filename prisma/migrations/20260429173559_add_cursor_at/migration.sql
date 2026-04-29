-- Phase 1 (PR-C): cursor age probe.
--
-- Captures the wall-clock time at which each cursor was last persisted, so
-- the worker can log cursorAgeMs at fetch time and characterize the
-- Shopify Admin API cursor TTL anomaly observed during PR-B's graceful-
-- shutdown tests (cursors went stale during ~70s container restarts).
--
-- All three columns are nullable. No data backfill — fields default to
-- NULL on existing rows; saveCursor (sync-jobs.server.ts) populates them
-- on the next batch boundary. This migration is additive and reversible.
--
-- Migration discipline (CLAUDE.md): hand-written. No `prisma migrate dev`
-- was run to produce this file. Verified against schema.prisma via
-- `prisma migrate diff` (read-only). Applied on Railway deploy via
-- `prisma migrate deploy`.

ALTER TABLE "CatalogSyncJob"
  ADD COLUMN "productsCursorAt" TIMESTAMP(3),
  ADD COLUMN "metaobjectsCursorAt" TIMESTAMP(3),
  ADD COLUMN "collectionsCursorAt" TIMESTAMP(3);
