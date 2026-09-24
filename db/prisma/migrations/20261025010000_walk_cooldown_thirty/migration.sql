-- The walk cooldown rises from 3s to 30s (MAP.md §3). Three seconds was a
-- click debounce; thirty is long enough that hopping between two rooms in a
-- zone is a decision, and it is the one brake on the cave arrival roll
-- (CAVING.md §2d).
--
-- The column default moves so `prisma migrate diff` stops proposing it as
-- drift, and the live row is raised only if a GM has not already set it
-- higher on /gm/dev.
ALTER TABLE "GameConfig" ALTER COLUMN "locationMoveCooldownSeconds" SET DEFAULT 30;
UPDATE "GameConfig" SET "locationMoveCooldownSeconds" = 30 WHERE "id" = 1 AND "locationMoveCooldownSeconds" < 30;
