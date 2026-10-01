-- A Caving find of a non-stackable tag the caver already holds is left in a
-- room they can get into, instead of vanishing (docs/systemdocs/CAVING.md §2g).
-- lootAlreadyHeld marks such a find and lootRoomId says which room, so the
-- Caving lens's Undo takes the tag back from there (or refuses, when nothing
-- was added) rather than off the caver's own copy. Every existing row is read
-- as it always was — false and NULL — so nothing to backfill.

ALTER TABLE "CavingRoll" ADD COLUMN "lootAlreadyHeld" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "CavingRoll" ADD COLUMN "lootRoomId" TEXT;

-- SET NULL: a room hard-deleted from /gm/dev/zones only loses the pointer.
ALTER TABLE "CavingRoll"
  ADD CONSTRAINT "CavingRoll_lootRoomId_fkey"
  FOREIGN KEY ("lootRoomId") REFERENCES "Room"("id") ON DELETE SET NULL ON UPDATE CASCADE;
