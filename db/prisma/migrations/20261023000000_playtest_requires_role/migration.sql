-- Whether Playtest mode also narrows the roster. Defaulted on, which is what
-- Playtest mode has always done, so an existing game is unaffected.
ALTER TABLE "GameConfig" ADD COLUMN "playtestRequiresRole" BOOLEAN NOT NULL DEFAULT true;
