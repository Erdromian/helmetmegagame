-- Drawback caps widen from 5 tags / 12 points to 6 tags / 13 points, to make
-- room for the new phobia and habit drawbacks added alongside this migration.
--
-- The existing row is moved too, not just the default: there is one GameConfig
-- and leaving it on the old numbers would mean the schema said 6/13 while the
-- game ran at 5/12.
ALTER TABLE "GameConfig" ALTER COLUMN "maxDrawbackTags" SET DEFAULT 6;
UPDATE "GameConfig" SET "maxDrawbackTags" = 6 WHERE "maxDrawbackTags" = 5;
ALTER TABLE "GameConfig" ALTER COLUMN "maxDrawbackPoints" SET DEFAULT 13;
UPDATE "GameConfig" SET "maxDrawbackPoints" = 13 WHERE "maxDrawbackPoints" = 12;
