-- The Thanati (docs/systemdocs/THANATI.md): this game's rolled Words of the
-- Circle and the cult's hideout on GameState, and the two rite tables.

ALTER TABLE "GameState" ADD COLUMN "riteWords" JSONB;
ALTER TABLE "GameState" ADD COLUMN "thanatiHideoutRoomId" TEXT;

CREATE TYPE "RiteAttemptStatus" AS ENUM ('OPEN', 'READY', 'FIRED', 'EXPIRED', 'CANCELLED');

CREATE TABLE "RiteAttempt" (
    "id" TEXT NOT NULL,
    "riteKey" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "roomName" TEXT NOT NULL,
    "status" "RiteAttemptStatus" NOT NULL DEFAULT 'OPEN',
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readyAt" TIMESTAMP(3),
    "firesAt" TIMESTAMP(3),
    "firedAt" TIMESTAMP(3),
    "participants" JSONB,
    "result" JSONB,

    CONSTRAINT "RiteAttempt_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RiteChant" (
    "id" TEXT NOT NULL,
    "attemptId" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "characterName" TEXT NOT NULL,
    "archiveSeq" BIGINT,
    "saidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RiteChant_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "RiteAttempt_status_idx" ON "RiteAttempt"("status");
CREATE INDEX "RiteAttempt_riteKey_roomId_status_idx" ON "RiteAttempt"("riteKey", "roomId", "status");
CREATE INDEX "RiteChant_attemptId_idx" ON "RiteChant"("attemptId");

ALTER TABLE "RiteChant" ADD CONSTRAINT "RiteChant_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "RiteAttempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;
