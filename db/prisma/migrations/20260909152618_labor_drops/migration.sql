-- The labor drop die's config table. docs/systemdocs/LABORDROPS.md.
--
-- Hand-trimmed. `prisma migrate dev` also proposed dropping
-- ArchiveEntry_content_trgm_idx, DirectMessage_content_trgm_idx,
-- Action_locationId_idx, Action.opposed and Room.soundproof — none of which
-- is drift this change introduced (CLAUDE.md, "Notes for future work"; the
-- same five were declined by name in 20260914020000_intercept_and_instant_travel).
-- Declined, all of them.

-- CreateEnum
CREATE TYPE "LaborDropLaborType" AS ENUM ('BASIC', 'SKILLED', 'HUNTING', 'FARMING', 'FISHING');

-- CreateEnum
CREATE TYPE "LaborDropKind" AS ENUM ('TAG', 'RESOURCES', 'NOTHING');

-- AlterTable
ALTER TABLE "Action" ADD COLUMN     "laborTier" TEXT;

-- CreateTable
CREATE TABLE "LaborDropOption" (
    "id" TEXT NOT NULL,
    "roll" INTEGER NOT NULL,
    "laborType" "LaborDropLaborType",
    "zoneId" TEXT,
    "locationId" TEXT,
    "kind" "LaborDropKind" NOT NULL,
    "tagId" TEXT,
    "resourceAmount" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LaborDropOption_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LaborDropOption_roll_laborType_zoneId_locationId_idx" ON "LaborDropOption"("roll", "laborType", "zoneId", "locationId");

-- AddForeignKey
ALTER TABLE "LaborDropOption" ADD CONSTRAINT "LaborDropOption_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "Zone"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LaborDropOption" ADD CONSTRAINT "LaborDropOption_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LaborDropOption" ADD CONSTRAINT "LaborDropOption_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;
