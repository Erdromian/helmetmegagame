-- The Combat Overhaul (docs/systemdocs/ATTACK.md, from Bascinet's
-- E:\Bascinet\V3\Combat\Combat Overhaul.docx).
--
-- Additive: two new tables, four enums, three new columns and one column pair
-- on the watch. Nothing is dropped or rewritten. The old Attack table stays
-- as legacy (nothing writes it any more), so a fight live on the turn this
-- deploys still settles by its own clock.
--
-- `prisma migrate diff` also proposed dropping Action_locationId_idx,
-- ArchiveEntry_content_trgm_idx and DirectMessage_content_trgm_idx. All three
-- are raw-SQL indexes Prisma cannot see (CLAUDE.md, "Notes for future work"),
-- so those drops are declined here.

-- CreateEnum
CREATE TYPE "CombatSide" AS ENUM ('ATTACKER', 'DEFENDER');

-- CreateEnum
CREATE TYPE "CombatRole" AS ENUM ('INITIATOR', 'COLLABORATOR', 'TARGET', 'INTERVENER');

-- CreateEnum
CREATE TYPE "CombatStatus" AS ENUM ('INVITED', 'JOINED', 'DECLINED', 'LEFT');

-- CreateEnum
CREATE TYPE "CombatEndReason" AS ENUM ('CALLED_OFF', 'TURN_ENDED', 'SIDE_EMPTY', 'GM');

-- AlterTable
ALTER TABLE "InterceptWatch" ADD COLUMN     "anyUnidentified" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "collaboratorIds" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "StagedEffect" ADD COLUMN     "combatId" TEXT;

-- AlterTable
ALTER TABLE "StagedMessage" ADD COLUMN     "combatId" TEXT;

-- CreateTable
CREATE TABLE "Combat" (
    "id" TEXT NOT NULL,
    "turnId" TEXT NOT NULL,
    "locationId" TEXT,
    "locationName" TEXT,
    "zoneId" TEXT,
    "fromAmbush" BOOLEAN NOT NULL DEFAULT false,
    "ambushOwnerId" TEXT,
    "openingMessage" TEXT,
    "distances" JSONB NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "endReason" "CombatEndReason",
    "resultMessage" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolvedByDiscordUserId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Combat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CombatParticipant" (
    "id" TEXT NOT NULL,
    "combatId" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "side" "CombatSide" NOT NULL,
    "role" "CombatRole" NOT NULL,
    "status" "CombatStatus" NOT NULL,
    "activeTurnId" TEXT,
    "alert" BOOLEAN NOT NULL,
    "snapshot" JSONB NOT NULL,
    "snapshotAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "die" INTEGER NOT NULL,
    "rolls" INTEGER[],
    "advantageSource" TEXT,
    "modifiers" JSONB NOT NULL,
    "total" INTEGER NOT NULL,
    "distance" INTEGER,
    "fromLocationId" TEXT,
    "fromLocationName" TEXT,
    "description" TEXT,
    "describedAt" TIMESTAMP(3),
    "callOffAt" TIMESTAMP(3),
    "answeredAt" TIMESTAMP(3),
    "leftAt" TIMESTAMP(3),
    "leftReason" TEXT,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CombatParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Combat_turnId_idx" ON "Combat"("turnId");

-- CreateIndex
CREATE INDEX "Combat_locationId_turnId_idx" ON "Combat"("locationId", "turnId");

-- CreateIndex
CREATE INDEX "CombatParticipant_characterId_idx" ON "CombatParticipant"("characterId");

-- CreateIndex
CREATE UNIQUE INDEX "CombatParticipant_combatId_characterId_key" ON "CombatParticipant"("combatId", "characterId");

-- CreateIndex
CREATE UNIQUE INDEX "CombatParticipant_characterId_activeTurnId_key" ON "CombatParticipant"("characterId", "activeTurnId");

-- CreateIndex
CREATE INDEX "StagedEffect_combatId_idx" ON "StagedEffect"("combatId");

-- CreateIndex
CREATE INDEX "StagedMessage_combatId_idx" ON "StagedMessage"("combatId");

-- AddForeignKey
ALTER TABLE "StagedMessage" ADD CONSTRAINT "StagedMessage_combatId_fkey" FOREIGN KEY ("combatId") REFERENCES "Combat"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StagedEffect" ADD CONSTRAINT "StagedEffect_combatId_fkey" FOREIGN KEY ("combatId") REFERENCES "Combat"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Combat" ADD CONSTRAINT "Combat_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CombatParticipant" ADD CONSTRAINT "CombatParticipant_combatId_fkey" FOREIGN KEY ("combatId") REFERENCES "Combat"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CombatParticipant" ADD CONSTRAINT "CombatParticipant_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The desk's live channel (20260921030000_desk_notify). A fight is a desk row
-- of its own, type 'combat', so a second GM's Combat lens moves the moment a
-- fight starts, somebody joins, writes, or calls it off.
DROP TRIGGER IF EXISTS "Combat_notify" ON "Combat";
CREATE TRIGGER "Combat_notify"
  AFTER INSERT OR UPDATE OR DELETE ON "Combat"
  FOR EACH ROW EXECUTE FUNCTION bascinet_desk_notify('combat');

-- A participant is not a desk row; it announces its PARENT fight, the
-- Delivery_notify shape, so the desk re-reads the whole fight.
CREATE OR REPLACE FUNCTION bascinet_combat_participant_notify() RETURNS trigger AS $$
DECLARE
  parent_id text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    parent_id := OLD."combatId";
  ELSE
    parent_id := NEW."combatId";
  END IF;
  PERFORM pg_notify(
    'bascinet_desk',
    json_build_object('t', 'combat', 'id', parent_id, 'op', 'row')::text
  );
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "CombatParticipant_notify" ON "CombatParticipant";
CREATE TRIGGER "CombatParticipant_notify"
  AFTER INSERT OR UPDATE OR DELETE ON "CombatParticipant"
  FOR EACH ROW EXECUTE FUNCTION bascinet_combat_participant_notify();
