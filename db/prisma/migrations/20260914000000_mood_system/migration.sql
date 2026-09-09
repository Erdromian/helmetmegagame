-- The fear dial becomes the mood dial (docs/systemdocs/MOOD.md).
--
-- The sign flips: fear counted UP from 0 to 100, mood counts DOWN from +64 to
-- −100, so a live playtest dial has to be negated to keep meaning the same
-- thing. Renaming rather than adding a column is deliberate — a reader the
-- rework missed would otherwise run silently backwards, where a rename makes
-- it a loud Prisma error.
ALTER TABLE "Character" RENAME COLUMN "fear" TO "mood";
UPDATE "Character" SET "mood" = -"mood";
ALTER TABLE "Character" RENAME COLUMN "moveFearTurnId" TO "moveMoodTurnId";
ALTER TABLE "Character" RENAME COLUMN "moveFearUsed" TO "moveMoodUsed";
ALTER TABLE "GameConfig" RENAME COLUMN "fearIntensity" TO "moodIntensity";
