-- The mount's (or the boat's) extra crossing is spent before the base one, so
-- parking a horse at an indoors door no longer takes back a crossing the rider
-- still had. This counts how many of Character.zoneMovesUsed were charged to a
-- bonus this turn; the differing-turn-id write resets it alongside the counter.
ALTER TABLE "Character" ADD COLUMN "zoneMovesBonusUsed" INTEGER NOT NULL DEFAULT 0;
