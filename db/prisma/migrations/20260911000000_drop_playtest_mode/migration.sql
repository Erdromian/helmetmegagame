-- Playtest mode is gone. Both target lists in web/lib/characterCreation.js
-- (PLAYTEST_LOCKED_ROLE_SLUGS / PLAYTEST_LOCKED_ZONE_NAMES) were empty, so
-- isPlaytestLocked always returned false and no reader behaved differently
-- for the switch either way. Added by 20260826140000_playtest_role_lock.

-- AlterTable
ALTER TABLE "GameConfig" DROP COLUMN "playtestModeEnabled";
