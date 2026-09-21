-- The field's productivity (db/lib/fieldProductivity.js, SOILERY.md §9): six knobs on
-- GameConfig for the curve, and one LocationField row per farming place for its pool.
-- Every column has a default and no row is made here, so nothing is backfilled: a
-- place with the `soilery` attribute starts with a full field and a multiplier of 1
-- the first time it is harvested or the turn pass reaches it.
ALTER TABLE "GameConfig" ADD COLUMN "farmFieldEnabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "GameConfig" ADD COLUMN "farmSustainMargin" DOUBLE PRECISION NOT NULL DEFAULT 0.15;
ALTER TABLE "GameConfig" ADD COLUMN "farmPoolTurns" DOUBLE PRECISION NOT NULL DEFAULT 4;
ALTER TABLE "GameConfig" ADD COLUMN "farmComfortFrac" DOUBLE PRECISION NOT NULL DEFAULT 0.75;
ALTER TABLE "GameConfig" ADD COLUMN "farmMinYield" DOUBLE PRECISION NOT NULL DEFAULT 0.25;
ALTER TABLE "GameConfig" ADD COLUMN "farmCurveExp" DOUBLE PRECISION NOT NULL DEFAULT 1;

CREATE TABLE "LocationField" (
    "locationId" TEXT NOT NULL,
    "pool" DOUBLE PRECISION,
    "yieldMult" DOUBLE PRECISION NOT NULL DEFAULT 1,

    CONSTRAINT "LocationField_pkey" PRIMARY KEY ("locationId")
);

ALTER TABLE "LocationField" ADD CONSTRAINT "LocationField_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;
