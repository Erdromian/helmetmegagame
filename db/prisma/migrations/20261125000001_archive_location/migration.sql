-- The Location each archive row happened at, by name, so /archive can narrow to
-- a Location and every room and conversation inside it (docs/systemdocs/ARCHIVE.md).
ALTER TABLE "ArchiveEntry" ADD COLUMN "locationName" TEXT;

-- Rows already written: from the place key, through whatever it names. A key
-- whose Location, Room or conversation has since been deleted stays NULL.
UPDATE "ArchiveEntry" a SET "locationName" = l."name"
  FROM "Location" l
  WHERE a."placeKey" = 'loc:' || l."id";

UPDATE "ArchiveEntry" a SET "locationName" = l."name"
  FROM "Room" r JOIN "Location" l ON l."id" = r."locationId"
  WHERE a."placeKey" = 'room:' || r."id";

UPDATE "ArchiveEntry" a SET "locationName" = l."name"
  FROM "PlayerThread" p JOIN "Location" l ON l."id" = p."locationId"
  WHERE a."placeKey" = 'conv:' || p."id";

-- An ACTION row has no place key, but its action JSON already names the Location.
UPDATE "ArchiveEntry" SET "locationName" = "action"->>'locationName'
  WHERE "kind" = 'ACTION' AND "action" ? 'locationName';
