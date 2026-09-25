-- The Soilery Rework (docs/systemdocs/SOILERY.md, COOKING.md).
--
-- A meal is cooked as one of three classes now, and the class rides on the
-- dish so any surface can draw a Lavish name in italics.
CREATE TYPE "MealClass" AS ENUM ('BASIC', 'SKILLED', 'LAVISH');
ALTER TABLE "Tag" ADD COLUMN "mealClass" "MealClass";

-- One Farm plants 100 crops. The old default (50) was a sowing cap on a plan
-- of crops, which no longer exists, so every row moves to the new number.
ALTER TABLE "GameConfig" ALTER COLUMN "farmMaxCrops" SET DEFAULT 100;
UPDATE "GameConfig" SET "farmMaxCrops" = 100;

-- The field's productivity is gone, and with it the per-place share.
UPDATE "Location" SET "attributes" = "attributes" - 'soileryRegen' WHERE "attributes" ? 'soileryRegen';

-- A Lavish meal can only be cooked where there is a kitchen. docs/zones.yaml
-- now marks the three places that have one, but db:import-zones never
-- updates a place that already exists, so the live rows are marked here.
UPDATE "Location" SET "attributes" = "attributes" || '{"kitchen": true}'::jsonb
WHERE "slug" IN ('town-7', 'fortress-4', 'undertown-7');
