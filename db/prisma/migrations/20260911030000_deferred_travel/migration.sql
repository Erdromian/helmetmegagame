-- A zone crossing that costs the Move no longer lands at once. The Move is
-- spent when the player confirms, but the character keeps standing where they
-- are until db/lib/travelArrivalPass.js walks them over at the next turn
-- advance — so nobody sees the destination's channels a turn early. Free
-- crossings and same-zone hops are untouched and still instant.
ALTER TABLE "Character" ADD COLUMN "travelToLocationId" TEXT;
ALTER TABLE "Character" ADD COLUMN "travelTurnId" TEXT;

ALTER TABLE "Character"
  ADD CONSTRAINT "Character_travelToLocationId_fkey"
  FOREIGN KEY ("travelToLocationId") REFERENCES "Location"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
