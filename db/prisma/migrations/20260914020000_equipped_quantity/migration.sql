-- Written by hand rather than from `migrate diff`, because the diff also
-- proposed dropping ArchiveEntry_content_trgm_idx, DirectMessage_content_trgm_idx,
-- Action_locationId_idx and Action.opposed. The first two are raw-SQL indexes
-- Prisma's schema cannot express (CLAUDE.md says decline them); the other two
-- are pre-existing drift this change has nothing to do with.

-- AlterTable
ALTER TABLE "CharacterTag" ADD COLUMN     "equippedQuantity" INTEGER NOT NULL DEFAULT 0;

-- Backfill. Every row already equipped was one slot spent under the old
-- one-slot-per-stack rule, so it is exactly one unit out under this one.
-- Without this every read that now asks `equippedQuantity > 0` — the rig, both
-- equip write paths, the Dev Panel strips — sees an empty rack on a character
-- who is fully kitted, while `equipped` goes on driving armour and mounts.
UPDATE "CharacterTag" SET "equippedQuantity" = 1 WHERE "equipped" = true;
