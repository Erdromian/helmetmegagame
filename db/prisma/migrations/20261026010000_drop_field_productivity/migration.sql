-- The field's productivity (the old SOILERY.md §9) is removed by the Soilery
-- Rework: every Farm now brings in exactly what the wither die says. Its
-- per-place pools and its six GameConfig knobs go with it. Kept separate
-- from 20261026000000_soilery_rework because it drops data.
DROP TABLE "LocationField";

ALTER TABLE "GameConfig" DROP COLUMN "farmFieldEnabled";
ALTER TABLE "GameConfig" DROP COLUMN "farmSustainMargin";
ALTER TABLE "GameConfig" DROP COLUMN "farmPoolTurns";
ALTER TABLE "GameConfig" DROP COLUMN "farmComfortFrac";
ALTER TABLE "GameConfig" DROP COLUMN "farmMinYield";
ALTER TABLE "GameConfig" DROP COLUMN "farmCurveExp";
