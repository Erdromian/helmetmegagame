-- Extract's own once-a-day cooldown (docs/systemdocs/FACTORY.md §3).
--
-- Cutting Godflesh no longer files an Action, so it no longer inherits "once
-- per turn" from @@unique([characterId, turnId]). This column is the claim
-- token that replaces it: the in-game DAY key, same shape as birdTurnId.
--
-- Additive: one nullable column, nothing dropped, nothing rewritten. NULL is
-- the right value for everybody — nobody has cut under the new rule yet, and
-- the first cut of the day claims it.
ALTER TABLE "Character" ADD COLUMN "extractDayKey" TEXT;
