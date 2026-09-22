-- The turn the Rite of Ascension appeared in the Grimoire (db/lib/ascensionReveal.js,
-- THANATI.md §5a). Nullable and NOT backfilled: a game already in flight reads as
-- "not revealed", so the rite drops out of the document until that game's cult has
-- finished its objectives, which is the intended behaviour and not a migration to fix.
ALTER TABLE "GameState" ADD COLUMN "ascensionRevealedTurn" INTEGER;
