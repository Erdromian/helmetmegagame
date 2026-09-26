-- The telephone overhaul (docs/systemdocs/PHONES.md, from Bascinet's
-- Phones design document). Additive apart from two partial indexes, which are
-- replaced rather than lost -- see below.

-- Every phone gets a four-digit number, and somebody may hold it without
-- being on a call. Nullable, and filled by the application, never here: Start
-- Game rolls the numbers (db/lib/phoneNumbers.js) and a phone with none is
-- given one the first time it is picked up.
ALTER TABLE "Room" ADD COLUMN "phoneNumber" INTEGER;
ALTER TABLE "Room" ADD COLUMN "phoneHolderId" TEXT;
ALTER TABLE "Room" ADD COLUMN "phoneHeldAt" TIMESTAMP(3);
ALTER TABLE "Room" ADD COLUMN "phoneHeldVia" TEXT;
ALTER TABLE "Room" ADD COLUMN "phoneIdleSince" TIMESTAMP(3);
ALTER TABLE "Room" ADD COLUMN "phonePaidUntil" TIMESTAMP(3);
ALTER TABLE "Room" ADD COLUMN "phoneObolPrompted" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Room" ADD COLUMN "phoneDeadSince" TIMESTAMP(3);

CREATE UNIQUE INDEX "Room_phoneNumber_key" ON "Room"("phoneNumber");
CREATE UNIQUE INDEX "Room_phoneHolderId_key" ON "Room"("phoneHolderId");
ALTER TABLE "Room" ADD CONSTRAINT "Room_phoneHolderId_fkey" FOREIGN KEY ("phoneHolderId") REFERENCES "Character"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- One receiver per PERSON moves off the call and onto the phone. The two
-- per-person indexes below said "a character is the caller or callee of at
-- most one live call", which was the same thing as holding one receiver while
-- a receiver could never change hands. Now it can: walk away from a live call
-- and somebody else may pick it up, and the one who walked off may dial out
-- from another phone while the first call is still running under their name.
-- Room_phoneHolderId_key above is the rule now -- one phone in one hand.
--
-- The two ROOM indexes stay exactly as they were. They are still what makes
-- "The number you are trying to call is currently busy." true rather than
-- hopeful, and a hand-written "fix drift" migration must still not drop them
-- (CLAUDE.md, Notes for future work).
DROP INDEX IF EXISTS "PhoneCall_caller_active_unique";
DROP INDEX IF EXISTS "PhoneCall_callee_active_unique";

-- A row only one person at the place may read, or one person may not. The
-- telephone's two voices (PHONES.md §6). Snapshot strings, no FKs, like
-- ArchiveEntry.characterId.
ALTER TABLE "ArchiveEntry" ADD COLUMN "onlyCharacterId" TEXT;
ALTER TABLE "ArchiveEntry" ADD COLUMN "exceptCharacterId" TEXT;

-- The Phonebook, into the stashes of the rooms that start with one. The YAML
-- only reaches a room that does not exist yet (db:import-zones skips the rest),
-- so the live game's rooms need it written here; the next Start Game or wipe
-- pours it (db/lib/roomStashSeed.js), since `phonebook` is not yet in any
-- room's seededStashSlugs. Only where the seed does not already name it, so a
-- second run -- or a GM who already typed it in -- changes nothing. `items` is
-- a list of [slug, quantity] pairs (db/lib/roomStashSeed.js#stashSeedEntries),
-- or a bare slug for a quantity of one.
UPDATE "Room" AS r
SET "stashSeed" = jsonb_set(
  COALESCE(r."stashSeed"::jsonb, '{}'::jsonb),
  '{items}',
  COALESCE(r."stashSeed"::jsonb -> 'items', '[]'::jsonb) || '[["phonebook", 1]]'::jsonb,
  true
)
WHERE r."slug" IN (
  'town-4-3',       -- Order Chambers
  'undertown-6-2',  -- Merchant's Office
  'fortress-4-1',   -- Keep: Council Room
  'fortress-4-6',   -- Keep: Baron's Study
  'fortress-4-7',   -- Keep: Storehouse
  'undertown-8-2',  -- Den: Dressing Room
  'undertown-3-3',  -- Lifeweb: Mortus Shacks
  'town-7-6',       -- Inn: Cellar
  'town-1-2',       -- Gatehouse: Watchhouse
  'fortress-1-2',   -- Cerberon: Censor's Office
  'fortress-1-3',   -- Cerberon: Barracks
  'fortress-1-5'    -- Cerberon: Armory
)
AND NOT EXISTS (
  SELECT 1
  FROM jsonb_array_elements(COALESCE(r."stashSeed"::jsonb -> 'items', '[]'::jsonb)) AS e(item)
  WHERE e.item #>> '{0}' = 'phonebook' OR e.item #>> '{}' = 'phonebook'
);
