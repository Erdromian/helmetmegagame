-- How many turns make one in-game day. 0 keeps the old rule (the day rolls at
-- Chicago midnight), so every existing game carries on exactly as before.
-- See docs/systemdocs/TURN-ENGINE.md.
ALTER TABLE "GameConfig" ADD COLUMN "turnsPerDay" INTEGER NOT NULL DEFAULT 0;
