-- The client-minted id for one send. Nullable, and null for every writer that
-- has no composer behind it (the bot, the bird, a turn notice).
ALTER TABLE "DirectMessage" ADD COLUMN "clientNonce" TEXT;

-- PARTIAL, so the nulls above never collide with each other. Prisma's schema
-- language cannot express a WHERE on an index, so this lives here and nowhere
-- else — `prisma migrate diff` will offer to drop it. Decline that, the way
-- the trgm indexes and FactionApplication_pending_unique are declined; without
-- it a retried send could land twice.
--
-- It doubles as the lookup index: every read of this column asks for one
-- non-null value, which is exactly what the index covers.
CREATE UNIQUE INDEX "DirectMessage_clientNonce_key"
  ON "DirectMessage"("clientNonce")
  WHERE "clientNonce" IS NOT NULL;
