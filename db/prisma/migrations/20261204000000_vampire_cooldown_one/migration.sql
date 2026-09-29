-- The Blood Abilities' cooldown variable `v` drops from 5 to 1 (VAMPIRE.md §6), so
-- the cooldowns read straight off the design doc's constants: 2, 4 and 6 turns
-- instead of 10, 20 and 30. At 24-hour turns the old numbers let a vampire cast
-- Corrupt about once a game.
--
-- Two statements because the default alone would not move anything: GameConfig is
-- a singleton whose row already holds 5. The UPDATE is guarded to 5 so a GM who has
-- tuned the knob to something else on /gm/dev keeps their number.
ALTER TABLE "GameConfig" ALTER COLUMN "vampireBloodAbilityCooldownVariable" SET DEFAULT 1;
UPDATE "GameConfig" SET "vampireBloodAbilityCooldownVariable" = 1 WHERE "vampireBloodAbilityCooldownVariable" = 5;
