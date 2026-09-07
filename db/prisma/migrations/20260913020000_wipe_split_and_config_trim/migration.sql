-- The message wipe stops being Dawn-gated: rooms, conversations and Location
-- channels clear every turn, zone summaries only on a Dawn. See CHANNELS.md §8.

-- The web's second watermark. feedWipeSeq keeps floring loc:/room:/conv:
-- places every turn; this one moves only on a Dawn and floors zone: places.
ALTER TABLE "GameConfig" ADD COLUMN "feedWipeSummarySeq" BIGINT NOT NULL DEFAULT 0;

-- It starts level with the turn watermark rather than at 0, so the first
-- Dusk after this deploy doesn't drag every zone summary back into the Hall.
UPDATE "GameConfig" SET "feedWipeSummarySeq" = "feedWipeSeq";

-- The wipe is no longer a knob. The column stays as a hand-flippable escape
-- hatch, but it is on by default and on for the existing row.
ALTER TABLE "GameConfig" ALTER COLUMN "messageWipeEnabled" SET DEFAULT true;
UPDATE "GameConfig" SET "messageWipeEnabled" = true;

-- Five columns nothing has ever moved off its default.
--   intercomChannelId      always NULL; #intercom is a Council Room button now
--   webOnlyCooldownSeconds never written; the constant lives in db/lib/webOnly.js
--   desiresEnabled         master on/off for a shipped system
--   catatonicEnabled       ditto; catatonicTurns/catatonicDeathTurns stay
--   autoReconcileEnabled   ditto; the cheap post-turn doctor just runs now
ALTER TABLE "GameConfig" DROP COLUMN "intercomChannelId";
ALTER TABLE "GameConfig" DROP COLUMN "webOnlyCooldownSeconds";
ALTER TABLE "GameConfig" DROP COLUMN "desiresEnabled";
ALTER TABLE "GameConfig" DROP COLUMN "catatonicEnabled";
ALTER TABLE "GameConfig" DROP COLUMN "autoReconcileEnabled";
