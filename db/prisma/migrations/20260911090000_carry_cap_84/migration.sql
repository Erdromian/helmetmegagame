-- The base carry cap comes down 30%, 120 -> 84 lb (docs/systemdocs/CARRY.md §1).
-- The live GameConfig row is moved too, but only if nobody has hand-set it.
ALTER TABLE "GameConfig" ALTER COLUMN "carryWeightLbs" SET DEFAULT 84;
UPDATE "GameConfig" SET "carryWeightLbs" = 84 WHERE "carryWeightLbs" = 120;
