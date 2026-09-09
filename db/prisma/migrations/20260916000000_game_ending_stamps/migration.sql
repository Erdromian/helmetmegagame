-- How a game ended now belongs to the game, not to the global GameState. Turn
-- numbers restart at 1 every game, so the GameState copies were meaningless
-- across a restart and a fresh game inherited the last one's fireball.
ALTER TABLE "Game" ADD COLUMN "nukeDetonatedTurn" INTEGER;
ALTER TABLE "Game" ADD COLUMN "ascensionFiredTurn" INTEGER;

-- DELIBERATELY NOT BACKFILLED from GameState. That row holds exactly one copy
-- of each stamp with no way to say which game it belongs to, and the only
-- candidate is the current game — whose stamp is the very leak this column
-- exists to stop. Every finished game already carries its ending as a
-- snapshotted Game.epilogue, so nothing readable is lost by starting null.
