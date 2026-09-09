-- The seat a player is dealt now holds for 12 hours, not 24.
ALTER TABLE "GameConfig" ALTER COLUMN "creationWindowHours" SET DEFAULT 12;

-- Move any config still sitting on the old default. A window a GM deliberately
-- set to something else is left alone.
UPDATE "GameConfig" SET "creationWindowHours" = 12 WHERE "creationWindowHours" = 24;
