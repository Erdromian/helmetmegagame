-- Written by hand rather than from `migrate diff`, because the diff also
-- proposed dropping ArchiveEntry_content_trgm_idx, DirectMessage_content_trgm_idx,
-- Action_locationId_idx and Action.opposed. The first two are raw-SQL indexes
-- Prisma's schema cannot express (CLAUDE.md says decline them); the other two
-- are pre-existing drift this change has nothing to do with.

-- AlterTable
ALTER TABLE "CharacterTag" ADD COLUMN     "equippedQuantity" INTEGER NOT NULL DEFAULT 0;
