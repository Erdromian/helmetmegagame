-- The Tower burns through its Blood faster: 10 a turn becomes 19.
--
-- Two statements because the default alone would not move anything. GameConfig is a
-- singleton whose row is upserted once and never rewritten, so the row already holds 10
-- explicitly and would keep it forever while the schema claimed 19 — the knob would read
-- one number on /gm/dev and another in docs/tags.yaml's sibling registry
-- (db/lib/gameConfigFields.js, which npm run db:check-config compares against this file).
--
-- The UPDATE is guarded to 10 on purpose: a GM who has deliberately tuned this to
-- something else keeps their number.
ALTER TABLE "GameConfig" ALTER COLUMN "lifewebDecayPerTurn" SET DEFAULT 19;
UPDATE "GameConfig" SET "lifewebDecayPerTurn" = 19 WHERE "lifewebDecayPerTurn" = 10;
