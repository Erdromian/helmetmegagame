-- The base carry cap comes down another 15%, 84 -> 71 lb (docs/systemdocs/CARRY.md §1).
-- The live GameConfig row is moved too, but only if nobody has hand-set it.
ALTER TABLE "GameConfig" ALTER COLUMN "carryWeightLbs" SET DEFAULT 71;
UPDATE "GameConfig" SET "carryWeightLbs" = 71 WHERE "carryWeightLbs" = 84;
