-- The Vampire's two 0-100 meters (docs/systemdocs/VAMPIRE.md). Named with a
-- `vampire` prefix rather than bare bloodLevel/humanity — this repo already
-- has an unrelated, load-bearing "blood" concept (Character.lifewebBlood,
-- the Lifeweb Tower; see CLAUDE.md) — and the per-day config rates
-- db/lib/vampirePass.js scales by the closing Turn's own turnLengthHours.
ALTER TABLE "Character"
  ADD COLUMN "vampireBloodLevel" INTEGER NOT NULL DEFAULT 100,
  ADD COLUMN "vampireHumanity"   INTEGER NOT NULL DEFAULT 100;

ALTER TABLE "GameConfig"
  ADD COLUMN "vampireBloodDecayPerDay"    INTEGER NOT NULL DEFAULT 34,
  ADD COLUMN "vampireHumanityRegenPerDay" INTEGER NOT NULL DEFAULT 10;
