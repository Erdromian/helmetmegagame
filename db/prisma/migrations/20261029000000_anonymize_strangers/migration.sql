-- Whether a face nobody has a Friends entry for reads as "a young man"
-- (docs/systemdocs/STRANGERS.md §9). On by default, so a running game keeps
-- the behaviour it already has.
ALTER TABLE "GameConfig" ADD COLUMN "anonymizeStrangers" BOOLEAN NOT NULL DEFAULT true;
