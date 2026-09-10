-- Three new buildings: Brewery, Rookery, Makeshift Stage.
--
-- Only the Rookery needs columns. The Brewery's per-turn pour claims the turn
-- on Structure.lastUpkeepTurnId, which has been sitting in the schema unused
-- for exactly this ("a claim column for a FUTURE decay/upkeep pass"), and the
-- Makeshift Stage rations itself on AuditLog rows the way /play already does.
-- Everything else the three need is Tag.placement, which is Json.
--
-- Both columns are additive with defaults, so this is safe to apply ahead of
-- the code that reads them: birdDaySends 0 against a null birdTurnId is the
-- state every character is already in, and the allowance falls back to 1.
ALTER TABLE "Character" ADD COLUMN "birdDaySends" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Character" ADD COLUMN "birdLastSentAt" TIMESTAMP(3);
