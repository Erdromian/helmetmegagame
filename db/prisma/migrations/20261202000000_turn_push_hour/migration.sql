-- The hour turns push at, set from /gm/dev (docs/systemdocs/TURN-ENGINE.md, the intro).
--
-- Additive: one column, nothing dropped. -1 is right for every existing row:
-- it means "the hour the game started", which is the rule the clock already follows.
ALTER TABLE "GameConfig" ADD COLUMN "turnPushHour" INTEGER NOT NULL DEFAULT -1;
