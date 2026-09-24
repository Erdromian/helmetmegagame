-- When a finished craft hands over what it makes. Defaulted to IMMEDIATE,
-- which is what crafting has always done, so an existing game is unaffected.
ALTER TABLE "GameConfig" ADD COLUMN "craftYieldTiming" TEXT NOT NULL DEFAULT 'IMMEDIATE';
