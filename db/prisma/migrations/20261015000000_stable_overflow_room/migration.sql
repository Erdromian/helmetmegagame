-- The stable's capacity cap has never fired, and this is why.
--
-- stableOverflowRoomSlug is where db/lib/stablePass.js puts the arelitz a
-- Stable holds past GameConfig.stableCapacity. It has defaulted to
-- "farms-fields" since 20260918093521_soilery_arelitz_rework — and that same
-- rework renamed the Soilery's Rooms to town-3-1 / town-3-2 / town-3-3, so no
-- zone has defined "farms-fields" since the day the column was added.
--
-- stablePass returns early when it cannot resolve the overflow Room, which is
-- the right call (it will not delete an animal it has nowhere to put) and also
-- the reason nobody noticed: step 4 simply never ran, and a stable grew past
-- 10 forever.
--
-- town-3-1 is "Farms", the open plots right next door to the Stable in the
-- same Location — the closest thing the map has to the design doc's
-- "streets/field".
ALTER TABLE "GameConfig" ALTER COLUMN "stableOverflowRoomSlug" SET DEFAULT 'town-3-1';

-- The default alone is not enough: the GameConfig singleton is upserted on bot
-- ready, so any row that already exists keeps the dead slug. Repair only the
-- rows still carrying it — a room a GM deliberately chose is left alone.
UPDATE "GameConfig" SET "stableOverflowRoomSlug" = 'town-3-1'
  WHERE "stableOverflowRoomSlug" = 'farms-fields';
