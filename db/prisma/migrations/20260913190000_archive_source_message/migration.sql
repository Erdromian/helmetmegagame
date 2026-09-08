-- The player's original Discord message id, as an idempotency key for the
-- proxy. bot/src/lib/proxy.js claims this row before posting the webhook, so a
-- redelivered messageCreate cannot produce a second post or a second row.
--
-- Additive: the column is nullable and every existing row keeps NULL, which a
-- Postgres unique index permits without limit.
ALTER TABLE "ArchiveEntry" ADD COLUMN "sourceDiscordMessageId" TEXT;

CREATE UNIQUE INDEX "ArchiveEntry_sourceDiscordMessageId_key"
  ON "ArchiveEntry"("sourceDiscordMessageId");
