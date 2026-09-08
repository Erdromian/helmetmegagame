-- The Rite of Ascension's countdown and the Rite of Fulfillment's once-ever
-- claim. All nullable, all on the GameState singleton, all wiped for free by
-- Restart Game (which recreates the row). See docs/systemdocs/THANATI.md.
ALTER TABLE "GameState" ADD COLUMN "ascensionArmedTurn" INTEGER;
ALTER TABLE "GameState" ADD COLUMN "ascensionFiredTurn" INTEGER;
ALTER TABLE "GameState" ADD COLUMN "ascensionLeaderCharacterId" TEXT;
ALTER TABLE "GameState" ADD COLUMN "fulfillmentFiredAt" TIMESTAMP(3);
