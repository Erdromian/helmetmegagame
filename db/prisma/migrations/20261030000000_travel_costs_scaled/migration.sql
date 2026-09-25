-- Travel is scaled up by two (docs/systemdocs/MAP.md §3): a crossing between
-- the town zones (Town, Fortress, Undertown) now costs 1 travel and any other
-- crossing costs 2, so everybody's free allowance doubles to match. The
-- running game's row moves with the default — left at 1, every crossing out
-- of town would have started spending the Move.
ALTER TABLE "GameConfig" ALTER COLUMN "freeZoneMovesPerTurn" SET DEFAULT 2;
UPDATE "GameConfig" SET "freeZoneMovesPerTurn" = 2 WHERE "freeZoneMovesPerTurn" = 1;
