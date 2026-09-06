-- The bomb's two pieces of global state, on the GameConfig singleton.
--
-- nukeArmedTurn     the absolute turn the device detonates on, or NULL when it
--                   is not armed. Set to (open turn + 2) by Arm, cleared by
--                   Disarm or by a GM defusing it.
-- nukeDetonatedTurn set once when it goes off and never cleared; it is what
--                   pins the fireball banner on for the rest of the game.
--
-- Both nullable with no default, so applying this to a live database changes
-- nothing until somebody arms one.
ALTER TABLE "GameConfig" ADD COLUMN "nukeArmedTurn" INTEGER;
ALTER TABLE "GameConfig" ADD COLUMN "nukeDetonatedTurn" INTEGER;
