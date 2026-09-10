-- Labor drops get rarity tiers.
--
-- The die used to draw uniformly over the concatenated pool, so the only way
-- to weight an entry was to repeat it: 87 of docs/labordrops.yaml's 180 lines
-- were duplicates, 53 more were `nothing` pads holding the wound rate down,
-- and nothing could ever be rarer than 1/poolsize.
--
-- A TAG row now carries a rarity from the same six-name ladder
-- db/lib/cavingLoot.js uses. What each name is worth lives in
-- db/lib/labordropsRarity.js, keyed by die face. NOTHING and RESOURCES rows
-- carry no rarity — neither is an item, and both sit in their own bands.
--
-- Additive and nullable, so `migrate deploy` applies it with no backfill. The
-- sync fully rebuilds LaborDropOption from the YAML on every run
-- (db/lib/syncLaborDrops.js), so existing rows are replaced rather than
-- migrated — which is also why nothing here has to guess a rarity for them.
CREATE TYPE "LaborDropRarity" AS ENUM ('ULTRACOMMON', 'COMMON', 'UNCOMMON', 'RARE', 'EXTREMELY_RARE', 'NEARLY_IMPOSSIBLE');
ALTER TABLE "LaborDropOption" ADD COLUMN "rarity" "LaborDropRarity";
