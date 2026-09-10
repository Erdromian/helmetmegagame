-- How many hand slots a maiming takes away (docs/systemdocs/TAGS.md).
--
-- Nullable, so a running old build ignores it and this is safe to apply ahead
-- of the code that reads it. Only the maimings carry a value.
ALTER TABLE "Tag" ADD COLUMN "handsLost" INTEGER;
