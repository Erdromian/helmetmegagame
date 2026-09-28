-- The Meistery Window (fortress-5-4) opens onto the Square (town-2) now, not
-- the Residences (town-8). docs/zones.yaml says so, but db:import-zones never
-- updates or deletes, so a running game needs the move written here.

-- Undo the Residences side the way /gm/dev/zones#removeRoomSide does: passes
-- given at that side open nothing any more, and a thread membership naming it
-- would point at nothing (db/lib/roomSides.js#membershipKey is
-- "<roomId>@<locationId>"). The side is public, so both are normally empty.
DELETE FROM "RoomGuest" AS g
USING "Room" AS r, "Location" AS l
WHERE g."roomId" = r."id"
  AND g."locationId" = l."id"
  AND r."slug" = 'fortress-5-4'
  AND l."slug" = 'town-8';

UPDATE "Character" AS c
SET "roomThreadRoomIds" = array_remove(c."roomThreadRoomIds", k.key)
FROM (
  SELECT r."id" || '@' || l."id" AS key
  FROM "Room" AS r, "Location" AS l
  WHERE r."slug" = 'fortress-5-4'
    AND l."slug" = 'town-8'
) AS k
WHERE k.key = ANY(c."roomThreadRoomIds");

DELETE FROM "RoomSide" AS s
USING "Room" AS r, "Location" AS l
WHERE s."roomId" = r."id"
  AND s."locationId" = l."id"
  AND r."slug" = 'fortress-5-4'
  AND l."slug" = 'town-8';

-- The Square side, public, after the Square's own three rooms. The name check
-- keeps the side off a room a GM may already have made at fortress-5-4, as
-- 20261120000000_meistery did. Its Discord thread is opened by the next
-- db:mirror; the old one in the Residences channel is left for a GM to delete,
-- since the mirror never deletes a thread.
INSERT INTO "RoomSide" ("id", "roomId", "locationId", "kind", "accessTagSlugs", "sortOrder", "updatedAt")
SELECT 'meistery-window-square-side', r."id", l."id", 'PUBLIC', ARRAY[]::TEXT[], 3, CURRENT_TIMESTAMP
FROM "Room" AS r, "Location" AS l
WHERE r."slug" = 'fortress-5-4'
  AND r."name" = 'Meistery Window'
  AND l."slug" = 'town-2'
ON CONFLICT ("roomId", "locationId") DO NOTHING;
