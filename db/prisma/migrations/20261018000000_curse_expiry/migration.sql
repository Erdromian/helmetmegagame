-- The turn a body fell on, so db/lib/curse.js can let an unburied body stop
-- cursing its player after CURSE_TURNS turns. Nullable and NOT backfilled: a
-- row with no number has no clock and never lapses, which is how every death
-- written before this column behaves.
ALTER TABLE "Character" ADD COLUMN "deathTurn" INTEGER;
