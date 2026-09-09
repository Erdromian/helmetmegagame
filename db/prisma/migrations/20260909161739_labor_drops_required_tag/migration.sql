-- The labor drop die's seventh gate: requiredTagId. Forester-in-the-Forest
-- is the first user. docs/systemdocs/LABORDROPS.md.
--
-- Hand-trimmed. `prisma migrate diff` also proposed dropping
-- ArchiveEntry_content_trgm_idx, DirectMessage_content_trgm_idx,
-- Action_locationId_idx, Action.opposed and Room.soundproof, plus resetting
-- GameConfig.locationMoveCooldownSeconds's default — none of which is drift
-- this change introduced (CLAUDE.md, "Notes for future work"; the first five
-- were declined by name in 20260914020000_intercept_and_instant_travel and
-- 20260909152618_labor_drops). Declined, all of them.

-- AlterTable
ALTER TABLE "LaborDropOption" ADD COLUMN     "requiredTagId" TEXT;

-- CreateIndex
CREATE INDEX "LaborDropOption_requiredTagId_idx" ON "LaborDropOption"("requiredTagId");

-- AddForeignKey
ALTER TABLE "LaborDropOption" ADD CONSTRAINT "LaborDropOption_requiredTagId_fkey" FOREIGN KEY ("requiredTagId") REFERENCES "Tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;
