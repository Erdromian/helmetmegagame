-- Combat mode (docs/systemdocs/COMBAT-MODE.md), and the snapshot a failed
-- cave roll keeps for the GM (docs/systemdocs/CAVING.md §5).
--
-- Additive: two nullable columns, nothing dropped, nothing rewritten. NULL is
-- the right value for every existing row: nobody is in combat mode yet, and a
-- roll made before this existed has no snapshot to give.
ALTER TABLE "Character" ADD COLUMN "combatModeSinceTurn" INTEGER;
ALTER TABLE "CavingRoll" ADD COLUMN "presentedState" JSONB;
