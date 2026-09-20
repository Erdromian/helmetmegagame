-- The per-turn fog of war stops being zone-shaped and becomes distance-shaped
-- (db/lib/vantages.js). A vantage now lasts only while the place is DIRECTLY
-- ADJACENT to where the character stands; which zone either sits in no longer
-- enters into it.
--
-- So the snapshot column changes with the rule it serves: "the zone this was
-- lit in" becomes "the Location the character stood in when this row was last
-- confirmed next door". A read is still one equality against a column rather
-- than a walk of the link graph, and a row left behind by a wipe that failed
-- to run still reads as dark the moment they move.
--
-- Every live row is by definition mid-turn scenery, so there is nothing worth
-- carrying across: the rows are emptied rather than backfilled with a lie, and
-- the next step anyone walks lights the fog again correctly.
DELETE FROM "Vantage";

ALTER TABLE "Vantage" DROP COLUMN "zoneId";
ALTER TABLE "Vantage" ADD COLUMN "anchorLocationId" TEXT NOT NULL;
