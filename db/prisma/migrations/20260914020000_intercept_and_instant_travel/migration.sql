-- Intercept: laying in wait, and the hold it puts on somebody.
-- docs/systemdocs/INTERCEPT.md
--
-- Hand-trimmed. `prisma migrate diff` also proposed dropping
-- ArchiveEntry_content_trgm_idx, DirectMessage_content_trgm_idx,
-- Action_locationId_idx, Action.opposed and Room.soundproof — none of which is
-- drift this change introduced, and the first two live only in raw migration
-- SQL that Prisma's schema cannot see (CLAUDE.md, "Notes for future work").
-- Declined, all of them.

-- CreateEnum
CREATE TYPE "InterceptMode" AS ENUM ('SAFE', 'AMBUSH');

-- AlterTable: the hold. One timestamp and who put it there; past the
-- timestamp the person is free, and nothing had to notice.
ALTER TABLE "Character" ADD COLUMN     "heldById" TEXT,
ADD COLUMN     "heldUntil" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "InterceptWatch" (
    "id" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "mode" "InterceptMode" NOT NULL DEFAULT 'SAFE',
    "message" TEXT NOT NULL DEFAULT '',
    "targetNames" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "anyConcealed" BOOLEAN NOT NULL DEFAULT false,
    "anyPerson" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InterceptWatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InterceptHit" (
    "id" TEXT NOT NULL,
    "watchId" TEXT NOT NULL,
    "targetCharacterId" TEXT NOT NULL,
    "turnId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InterceptHit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "InterceptWatch_characterId_key" ON "InterceptWatch"("characterId");

-- CreateIndex
CREATE INDEX "InterceptHit_targetCharacterId_idx" ON "InterceptHit"("targetCharacterId");

-- CreateIndex: the ration. The unique IS the once-per-turn-per-target rule —
-- the insert is what claims a catch, so two arrivals in one tick cannot both
-- pass.
CREATE UNIQUE INDEX "InterceptHit_watchId_targetCharacterId_turnId_key" ON "InterceptHit"("watchId", "targetCharacterId", "turnId");

-- CreateIndex
CREATE INDEX "Character_heldById_idx" ON "Character"("heldById");

-- AddForeignKey
ALTER TABLE "Character" ADD CONSTRAINT "Character_heldById_fkey" FOREIGN KEY ("heldById") REFERENCES "Character"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InterceptWatch" ADD CONSTRAINT "InterceptWatch_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InterceptHit" ADD CONSTRAINT "InterceptHit_watchId_fkey" FOREIGN KEY ("watchId") REFERENCES "InterceptWatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InterceptHit" ADD CONSTRAINT "InterceptHit_targetCharacterId_fkey" FOREIGN KEY ("targetCharacterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;
