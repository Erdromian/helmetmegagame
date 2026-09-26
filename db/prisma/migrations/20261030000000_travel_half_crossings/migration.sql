-- Travel comes in halves (docs/systemdocs/MAP.md §3): a crossing between the
-- town zones (Town, Fortress, Undertown) costs 0.5 travel and any other
-- crossing costs 1, out of the same 1 free travel a turn everybody already
-- had. So the allowance and both spent counters become DOUBLE PRECISION.
-- Halves are exact in a double, and every existing whole number converts
-- as-is, so the running game's row and every character's counter keep their
-- values: a far crossing still costs exactly what one crossing did before.
ALTER TABLE "GameConfig" ALTER COLUMN "freeZoneMovesPerTurn" SET DATA TYPE DOUBLE PRECISION,
ALTER COLUMN "freeZoneMovesPerTurn" SET DEFAULT 1;

ALTER TABLE "Character" ALTER COLUMN "zoneMovesUsed" SET DATA TYPE DOUBLE PRECISION,
ALTER COLUMN "zoneMovesBonusUsed" SET DATA TYPE DOUBLE PRECISION;
