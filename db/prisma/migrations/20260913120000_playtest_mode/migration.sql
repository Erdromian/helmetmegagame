-- Playtest mode: narrows the roster to GMs, playtesters and Contributors.
-- Additive, defaulted off, so an existing game is unaffected.
ALTER TABLE "GameConfig" ADD COLUMN "playtestModeEnabled" BOOLEAN NOT NULL DEFAULT false;
