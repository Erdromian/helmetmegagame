-- The Depot's only way is the Storefront, and the Sewer opens onto the Old
-- Town instead of the Lake.
--
-- Three of the Depot's edges go: the cave Entrance (plain), the Brooding
-- Grounds (hidden, caving) and the Old Town (plain). The Old Town opens off
-- the Storefront instead, so it stays reachable without the Baron's key. The
-- Sewer's plain edge onto the Lake goes, and the Sewer opens onto the Old Town.
--
-- db:import-zones never updates or deletes an edge that already exists, so
-- changing docs/zones.yaml does not reach a database that has these edges;
-- this does. On a fresh database the DELETE matches nothing and the INSERTs
-- skip the edges the importer already made from the new YAML.
DELETE FROM "LocationLink" AS l
USING "Location" AS a, "Location" AS b
WHERE a."id" = l."aId"
  AND b."id" = l."bId"
  AND (a."slug", b."slug") IN (
    ('caves-1', 'undertown-5'), ('undertown-5', 'caves-1'),
    ('caves-4', 'undertown-5'), ('undertown-5', 'caves-4'),
    ('undertown-2', 'undertown-5'), ('undertown-5', 'undertown-2'),
    ('undertown-4', 'undertown-c'), ('undertown-c', 'undertown-4')
  );

-- Plain edges, every column at its default. The ends are stored in ascending
-- slug order (db/lib/locationGraph.js#orderEndpoints): 'undertown-2' comes
-- before both 'undertown-4' and 'undertown-6'.
INSERT INTO "LocationLink" ("id", "aId", "bId", "updatedAt")
SELECT 'oldtown-storefront', a."id", b."id", CURRENT_TIMESTAMP
FROM "Location" AS a, "Location" AS b
WHERE a."slug" = 'undertown-2'
  AND b."slug" = 'undertown-6'
ON CONFLICT ("aId", "bId") DO NOTHING;

INSERT INTO "LocationLink" ("id", "aId", "bId", "updatedAt")
SELECT 'oldtown-sewer', a."id", b."id", CURRENT_TIMESTAMP
FROM "Location" AS a, "Location" AS b
WHERE a."slug" = 'undertown-2'
  AND b."slug" = 'undertown-4'
ON CONFLICT ("aId", "bId") DO NOTHING;
