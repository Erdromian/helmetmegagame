-- Games that outlive the wipe (docs/systemdocs/LOBBY.md §7, ARCHIVE.md).
-- Idempotent, like its predecessor: the shared checkout applies what is on disk.

CREATE TABLE IF NOT EXISTS "Game" (
    "id" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "closingNote" TEXT,
    "playerCount" INTEGER,
    "epilogue" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Game_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "Game_number_key" ON "Game"("number");

-- Game 1 is whatever is running now, carried across from GameState.
INSERT INTO "GameState" ("id") VALUES (1) ON CONFLICT ("id") DO NOTHING;
INSERT INTO "Game" ("id", "number", "startedAt", "endedAt", "closingNote", "playerCount")
SELECT 'game1', 1, s."startedAt", s."endedAt", s."closingNote", s."playerCount"
FROM "GameState" s WHERE s."id" = 1
ON CONFLICT ("number") DO NOTHING;

ALTER TABLE "GameState" ADD COLUMN IF NOT EXISTS "gameId" TEXT;
UPDATE "GameState" SET "gameId" = (SELECT "id" FROM "Game" WHERE "number" = 1) WHERE "gameId" IS NULL;
ALTER TABLE "GameState" ALTER COLUMN "gameId" SET NOT NULL;
DO $$ BEGIN
  ALTER TABLE "GameState" ADD CONSTRAINT "GameState_gameId_fkey"
    FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Every transcript row so far belongs to Game 1.
ALTER TABLE "ArchiveEntry" ADD COLUMN IF NOT EXISTS "gameId" TEXT;
UPDATE "ArchiveEntry" SET "gameId" = (SELECT "id" FROM "Game" WHERE "number" = 1) WHERE "gameId" IS NULL;
ALTER TABLE "ArchiveEntry" ALTER COLUMN "gameId" SET NOT NULL;
CREATE INDEX IF NOT EXISTS "ArchiveEntry_gameId_sentAt_id_idx" ON "ArchiveEntry"("gameId", "sentAt", "id");

-- LobbyEntry: the DM-delivered stamp the sweep resends on; the write-only
-- `source` column goes (the roll's rows are in the game_started audit row).
ALTER TABLE "LobbyEntry" ADD COLUMN IF NOT EXISTS "notifiedAt" TIMESTAMP(3);
ALTER TABLE "LobbyEntry" DROP COLUMN IF EXISTS "source";
