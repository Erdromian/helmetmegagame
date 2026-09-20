-- The Rite of Conversion becomes a consent handshake (docs/systemdocs/THANATI.md).
-- Two additive changes, both safe to apply ahead of the code that reads them.

-- A new Offer kind. ADD VALUE cannot run inside a transaction block on older
-- Postgres, hence IF NOT EXISTS rather than a guarded DO block.
ALTER TYPE "OfferKind" ADD VALUE IF NOT EXISTS 'CONVERSION';

-- The first per-offer clock. Null for every kind but CONVERSION, which is why
-- there is nothing to backfill.
ALTER TABLE "Offer" ADD COLUMN "expiresAt" TIMESTAMP(3);

-- What the three-hour sweep in db/lib/riteSweep.js reads.
CREATE INDEX "Offer_status_expiresAt_idx" ON "Offer"("status", "expiresAt");
