-- How a character looked when they acted, for GMs only (db/lib/gmPresentation.js):
-- hooded, disguised or going by a public name, and what as. Frozen on the row because
-- a disguise's tag is deleted once nobody holds it, so it cannot be worked out later.
-- Additive and nullable: rows from before this read as "no stamp" and the desk shows
-- the live look instead. Nothing to backfill.
ALTER TABLE "Action" ADD COLUMN "presentedAs" JSONB;
ALTER TABLE "CombatParticipant" ADD COLUMN "presentedAs" JSONB;
ALTER TABLE "CavingRoll" ADD COLUMN "presentedAs" JSONB;
