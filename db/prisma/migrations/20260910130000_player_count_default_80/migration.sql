-- The expected game size drops from 100 to 80. This is the denominator for
-- every capped role's seat count (roleCapacity: round(weight * playerCount / 100)),
-- so it narrows every weighted role proportionally without touching docs/roles.yaml.
--
-- The existing row is moved too, not just the default: there is one GameConfig
-- and leaving it on 100 would mean the schema said 80 while the game ran at 100.
ALTER TABLE "GameConfig" ALTER COLUMN "playerCount" SET DEFAULT 80;
UPDATE "GameConfig" SET "playerCount" = 80 WHERE "playerCount" = 100;
