-- The Lake's two shores outside the fort.
--
-- The East River no longer runs into the Undertown's Lake: the edge goes.
--
-- The Grand Chamber's way across the Lake was plain, so anybody could walk
-- from the Bridge through the Caves and the Depths into the Undertown without
-- passing the gate. It now needs Strong Swimmer, listed rather than hidden
-- (everybody on either shore can see the water go on), and it dismounts a
-- rider like every other swim.
--
-- db:import-zones never updates or deletes an edge that already exists, so
-- changing docs/zones.yaml does not reach a database that has these edges;
-- this does. On a fresh database the DELETE matches nothing and the UPDATE
-- matches the edge the importer creates from the new YAML, which is a no-op.
DELETE FROM "LocationLink" AS l
USING "Location" AS a, "Location" AS b
WHERE a."id" = l."aId"
  AND b."id" = l."bId"
  AND (
       (a."slug", b."slug") = ('east-river', 'undertown-c')
    OR (b."slug", a."slug") = ('east-river', 'undertown-c')
  );

UPDATE "LocationLink" AS l
SET "requiredTagSlug" = 'strong-swimmer',
    "hidden" = false,
    "onFoot" = true
FROM "Location" AS a, "Location" AS b
WHERE a."id" = l."aId"
  AND b."id" = l."bId"
  AND (
       (a."slug", b."slug") = ('depths-5', 'undertown-c')
    OR (b."slug", a."slug") = ('depths-5', 'undertown-c')
  );
