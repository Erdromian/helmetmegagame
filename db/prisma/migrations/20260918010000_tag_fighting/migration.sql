-- What a tag does in a fight (docs/systemdocs/COMBAT.md).
--
-- One nullable column, so a running old build ignores it and this is safe to
-- apply before the code that reads it ships. Most of the catalog stays NULL;
-- roughly 150 tags carry a block.
ALTER TABLE "Tag" ADD COLUMN "fighting" JSONB;
