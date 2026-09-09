-- What one character knows of the map: the fog behind /map.
--
-- Nothing recorded this before. AuditLog has no locationId, ArchiveEntry is
-- keyed to a zone rather than a Location, and a free in-zone hop files no
-- Action at all, so there was no way to answer "have I been here" from the
-- existing tables. See db/lib/locationVisits.js and MAP.md §6.

CREATE TABLE "LocationVisit" (
    "id" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "stood" BOOLEAN NOT NULL DEFAULT false,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LocationVisit_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LocationVisit_characterId_locationId_key"
    ON "LocationVisit"("characterId", "locationId");

CREATE INDEX "LocationVisit_characterId_idx" ON "LocationVisit"("characterId");

ALTER TABLE "LocationVisit" ADD CONSTRAINT "LocationVisit_characterId_fkey"
    FOREIGN KEY ("characterId") REFERENCES "Character"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LocationVisit" ADD CONSTRAINT "LocationVisit_locationId_fkey"
    FOREIGN KEY ("locationId") REFERENCES "Location"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------- backfill
--
-- Characters have been playing with no record kept, so their maps would open
-- blank. These three recover what is actually recoverable.
--
-- All of them write `stood` rows ONLY, never neighbours. Adjacency in raw SQL
-- cannot evaluate a hidden edge against a character's tags, and a backfill
-- that guessed would hand out the three secret crawls into the Depths.
-- Neighbours accrue correctly from the first loadMap() onward.

-- 1. Where everyone is standing, and where anyone on the road is headed.
INSERT INTO "LocationVisit" ("id", "characterId", "locationId", "stood")
SELECT gen_random_uuid()::text, c."id", c."locationId", true
FROM "Character" c
WHERE c."locationId" IS NOT NULL
ON CONFLICT ("characterId", "locationId") DO NOTHING;

INSERT INTO "LocationVisit" ("id", "characterId", "locationId", "stood")
SELECT gen_random_uuid()::text, c."id", c."travelToLocationId", true
FROM "Character" c
WHERE c."travelToLocationId" IS NOT NULL
ON CONFLICT ("characterId", "locationId") DO NOTHING;

-- 2. Paid zone crossings. Action.locationId is NOT stamped by a crossing --
--    only the destination's SEAT zone is (db/lib/locationTravel.js) -- so the
--    one durable trace of where somebody went is the auto-description, which
--    the game writes in a fixed format:
--
--        Set out for {Name} ({Zone}) — arrives next turn.
--
--    The trailing "(" is what stops one Location name that prefixes another
--    from matching both.
INSERT INTO "LocationVisit" ("id", "characterId", "locationId", "stood", "firstSeenAt")
SELECT DISTINCT ON (a."characterId", l."id")
       gen_random_uuid()::text, a."characterId", l."id", true, a."createdAt"
FROM "Action" a
JOIN "Location" l ON a."description" LIKE 'Set out for ' || l."name" || ' (%'
WHERE a."type" = 'MOVE'
  AND a."gmNotes" = 'auto:zone_change'
ORDER BY a."characterId", l."id", a."createdAt"
ON CONFLICT ("characterId", "locationId") DO NOTHING;

-- 3. Cave arrivals. The Caving Die fires on arrival at a CAVE_LEVEL and stamps
--    a real locationId, which recovers underground history the Actions above
--    cannot -- a free crossing into the Caves files no Action, but it still
--    rolls.
INSERT INTO "LocationVisit" ("id", "characterId", "locationId", "stood", "firstSeenAt")
SELECT DISTINCT ON (r."characterId", r."locationId")
       gen_random_uuid()::text, r."characterId", r."locationId", true, r."createdAt"
FROM "CavingRoll" r
WHERE r."trigger" = 'ARRIVAL'
  AND r."locationId" IS NOT NULL
ORDER BY r."characterId", r."locationId", r."createdAt"
ON CONFLICT ("characterId", "locationId") DO NOTHING;
