-- Game phases, per-game state, the lobby (docs/systemdocs/LOBBY.md).
--
-- Written idempotently on purpose: the shared checkout applies whatever is on
-- disk, so a statement that is safe to run twice is worth more than one that
-- is not. The live GameConfig values that move to GameState are carried across
-- before their columns are dropped.

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "GamePhase" AS ENUM ('CLOSED', 'LOBBY', 'RUNNING', 'ENDED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "JoblessRole" AS ENUM ('COMMONER', 'MIGRANT', 'RETURN_TO_LOBBY');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "LobbyStatus" AS ENUM ('READY', 'ASSIGNED', 'CREATED', 'DECLINED', 'EXPIRED', 'UNASSIGNED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "GameState" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "phase" "GamePhase" NOT NULL DEFAULT 'CLOSED',
    "lobbyOpenedAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "playerCount" INTEGER,
    "closingNote" TEXT,
    "assignmentDraft" JSONB,
    "archiveVisible" BOOLEAN NOT NULL DEFAULT false,
    "lifewebBlood" INTEGER NOT NULL DEFAULT 100,
    "nextWeather" "Weather",
    "nextTurnNote" TEXT,
    "nukeArmedTurn" INTEGER,
    "nukeDetonatedTurn" INTEGER,
    "gatehouseTurretArmed" BOOLEAN NOT NULL DEFAULT false,
    "bellRungAt" TIMESTAMP(3),

    CONSTRAINT "GameState_pkey" PRIMARY KEY ("id")
);

-- Carry the live game across. A game that was "open to players" is a game
-- that is RUNNING; anything else lands CLOSED, which is where a wipe lands too.
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'GameConfig' AND column_name = 'openToPlayers'
  ) THEN
    INSERT INTO "GameState" (
      "id", "phase", "archiveVisible", "lifewebBlood", "nextWeather", "nextTurnNote",
      "nukeArmedTurn", "nukeDetonatedTurn", "gatehouseTurretArmed", "bellRungAt"
    )
    SELECT
      1,
      CASE WHEN "openToPlayers" THEN 'RUNNING'::"GamePhase" ELSE 'CLOSED'::"GamePhase" END,
      "archiveVisible", "lifewebBlood", "nextWeather", "nextTurnNote",
      "nukeArmedTurn", "nukeDetonatedTurn", "gatehouseTurretArmed", "bellRungAt"
    FROM "GameConfig" WHERE "id" = 1
    ON CONFLICT ("id") DO NOTHING;
  END IF;
END $$;

INSERT INTO "GameState" ("id") VALUES (1) ON CONFLICT ("id") DO NOTHING;

-- CreateTable
CREATE TABLE IF NOT EXISTS "PlayerPreference" (
    "discordUserId" TEXT NOT NULL,
    "rolePriorities" JSONB NOT NULL DEFAULT '{}',
    "antagonistOptIns" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "joblessRole" "JoblessRole" NOT NULL DEFAULT 'COMMONER',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlayerPreference_pkey" PRIMARY KEY ("discordUserId")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "LobbyEntry" (
    "id" TEXT NOT NULL,
    "discordUserId" TEXT NOT NULL,
    "status" "LobbyStatus" NOT NULL DEFAULT 'READY',
    "readyAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assignedRoleId" TEXT,
    "assignedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "reminderSentAt" TIMESTAMP(3),
    "characterId" TEXT,
    "source" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LobbyEntry_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "LobbyEntry_discordUserId_key" ON "LobbyEntry"("discordUserId");
CREATE INDEX IF NOT EXISTS "LobbyEntry_status_expiresAt_idx" ON "LobbyEntry"("status", "expiresAt");
CREATE INDEX IF NOT EXISTS "LobbyEntry_assignedRoleId_status_idx" ON "LobbyEntry"("assignedRoleId", "status");

DO $$ BEGIN
  ALTER TABLE "LobbyEntry" ADD CONSTRAINT "LobbyEntry_assignedRoleId_fkey"
    FOREIGN KEY ("assignedRoleId") REFERENCES "Role"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- GameConfig: the new knob, then the columns that moved or were orphans.
ALTER TABLE "GameConfig" ADD COLUMN IF NOT EXISTS "creationWindowHours" INTEGER NOT NULL DEFAULT 24;

ALTER TABLE "GameConfig"
  DROP COLUMN IF EXISTS "openToPlayers",
  DROP COLUMN IF EXISTS "archiveVisible",
  DROP COLUMN IF EXISTS "lifewebBlood",
  DROP COLUMN IF EXISTS "nextWeather",
  DROP COLUMN IF EXISTS "nextTurnNote",
  DROP COLUMN IF EXISTS "nukeArmedTurn",
  DROP COLUMN IF EXISTS "nukeDetonatedTurn",
  DROP COLUMN IF EXISTS "gatehouseTurretArmed",
  DROP COLUMN IF EXISTS "bellRungAt",
  DROP COLUMN IF EXISTS "turnsAnnouncementChannelId",
  DROP COLUMN IF EXISTS "turnsAnnouncementMessageId",
  DROP COLUMN IF EXISTS "turnsBannerMessageId",
  DROP COLUMN IF EXISTS "mindlinkChannelId";
