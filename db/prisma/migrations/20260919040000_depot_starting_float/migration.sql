-- The Depot opens with a float of its own.
--
-- Restart Game deletes the Depot row and recreates it bare, so this default IS
-- the station's starting balance for every new game. It is separate from the
-- Merchant's purse (20 ¢ of obol tags from docs/roles.yaml); the two pots
-- never draw on each other.
--
-- Only the default moves. The live row is set by hand, because an existing
-- game's balance is a fact about that game and must not be overwritten.
ALTER TABLE "Depot" ALTER COLUMN "accountObols" SET DEFAULT 20;
