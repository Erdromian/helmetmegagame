-- The Oracle (docs/systemdocs/ORACLE.md): a per-turn chronicle, drafted once
-- per zone by a cheap model and rewritten by hand where a GM disagrees.
--
-- Two halves. GameConfig gains the provider settings and the two editable
-- prompts; OracleSynopsis holds the pages themselves. Nothing is backfilled --
-- the Oracle is off by default and writes its first rows on the first turn
-- that advances with it enabled.

-- Provider settings. baseUrl is what is actually called, so a proxied or
-- self-hosted endpoint needs no code change; provider is only a label.
ALTER TABLE "GameConfig" ADD COLUMN "oracleEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "GameConfig" ADD COLUMN "oracleProvider" TEXT NOT NULL DEFAULT 'openrouter';
ALTER TABLE "GameConfig" ADD COLUMN "oracleBaseUrl" TEXT NOT NULL DEFAULT 'https://openrouter.ai/api/v1';
ALTER TABLE "GameConfig" ADD COLUMN "oracleModel" TEXT NOT NULL DEFAULT 'deepseek/deepseek-v4-flash';

-- A real credential in a column, which DISCORD_TOKEN deliberately is not. The
-- trade is that the provider can be swapped without a deploy; the cost is that
-- it rides along in every pg_dump, and it must never enter an archive packet.
ALTER TABLE "GameConfig" ADD COLUMN "oracleApiKey" TEXT;
ALTER TABLE "GameConfig" ADD COLUMN "oracleApiKeySetAt" TIMESTAMP(3);
ALTER TABLE "GameConfig" ADD COLUMN "oracleApiKeySetBy" TEXT;

-- How many previous turns ride along as context. 0 writes every turn blind.
ALTER TABLE "GameConfig" ADD COLUMN "oracleMemoryTurns" INTEGER NOT NULL DEFAULT 3;
ALTER TABLE "GameConfig" ADD COLUMN "oracleIncludeChat" BOOLEAN NOT NULL DEFAULT false;

-- NULL means the built-in default in db/lib/oraclePrompts.js. Stored rather
-- than hardcoded so the voice can be tuned without a deploy.
ALTER TABLE "GameConfig" ADD COLUMN "oracleCorrespondentPrompt" TEXT;
ALTER TABLE "GameConfig" ADD COLUMN "oracleEditorPrompt" TEXT;

-- CreateTable
CREATE TABLE "OracleSynopsis" (
    "id" TEXT NOT NULL,
    "turnId" TEXT NOT NULL,
    "zoneId" TEXT,
    "body" TEXT NOT NULL,
    "threads" JSONB,
    "editedByDiscordUserId" TEXT,
    "editedAt" TIMESTAMP(3),
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OracleSynopsis_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OracleSynopsis_turnId_idx" ON "OracleSynopsis"("turnId");

-- CreateIndex
CREATE UNIQUE INDEX "OracleSynopsis_turnId_zoneId_key" ON "OracleSynopsis"("turnId", "zoneId");

-- One FRONT PAGE per turn. The unique above cannot say this: zoneId is
-- nullable and Postgres treats NULLs as distinct, so it would allow any number
-- of front pages for one turn. A partial unique index, which Prisma's schema
-- language cannot express, so it exists only here -- `prisma migrate diff`
-- will propose dropping it and the answer is no. Same shape as
-- ThreatSpawn_pending_unique and FactionApplication_pending_unique.
CREATE UNIQUE INDEX "OracleSynopsis_front_page_unique" ON "OracleSynopsis"("turnId") WHERE "zoneId" IS NULL;

-- AddForeignKey
ALTER TABLE "OracleSynopsis" ADD CONSTRAINT "OracleSynopsis_turnId_fkey" FOREIGN KEY ("turnId") REFERENCES "Turn"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OracleSynopsis" ADD CONSTRAINT "OracleSynopsis_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "Zone"("id") ON DELETE CASCADE ON UPDATE CASCADE;
