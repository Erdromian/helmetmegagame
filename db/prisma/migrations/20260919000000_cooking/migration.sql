-- Cooking: a meal is what went into it.
--
-- Six additive, nullable-or-defaulted columns on Tag. Nothing is dropped and
-- nothing is rewritten, so `migrate deploy` applies this without a backfill
-- and an older build reading the same database is unaffected.
--
--   cooked                     what a tag contributes AS AN INGREDIENT
--                              ({ taste, mood, into? }). Its presence is the
--                              only thing that makes a tag cookable.
--   cookedFrom                 the ingredient slugs a minted dish was made
--                              from. Empty on every catalog row.
--   mealMood                   a meal recipe's own small mood, before its
--                              ingredients.
--   requirementIngredientSlots { min, max } — how many ingredients a recipe
--                              takes.
--   customCost                 what a customizable recipe charges for the
--                              player's words. NULL means the standard
--                              surcharge; 0 means free (both meals).
--   customDescribable          whether it takes a description at all. The
--                              Fine Meal takes a name only, so this is the
--                              one row in the catalog that sets it false.
--
-- See docs/systemdocs/COOKING.md.
ALTER TABLE "Tag" ADD COLUMN "cooked" JSONB;
ALTER TABLE "Tag" ADD COLUMN "cookedFrom" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Tag" ADD COLUMN "mealMood" DOUBLE PRECISION;
ALTER TABLE "Tag" ADD COLUMN "requirementIngredientSlots" JSONB;
ALTER TABLE "Tag" ADD COLUMN "customCost" INTEGER;
ALTER TABLE "Tag" ADD COLUMN "customDescribable" BOOLEAN NOT NULL DEFAULT true;
