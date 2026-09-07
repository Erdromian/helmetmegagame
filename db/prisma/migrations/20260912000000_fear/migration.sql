-- The hidden fear dial (docs/systemdocs/FEAR.md). Both columns default, no drops.
ALTER TABLE "Character" ADD COLUMN "fear" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "GameConfig" ADD COLUMN "fearIntensity" DOUBLE PRECISION NOT NULL DEFAULT 1;
