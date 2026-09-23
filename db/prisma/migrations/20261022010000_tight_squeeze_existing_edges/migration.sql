-- Flag the three tight squeezes on a database that already had these edges.
--
-- db:import-zones only ever adds edges, so the `tight_squeeze: true` lines in
-- docs/zones.yaml never reach an edge that was imported before the flag
-- existed. This sets it on those three. On a fresh database it matches
-- nothing, and the import creates the edges with the flag already set.
-- See MAP.md's "Tight squeeze" section for what a Giant loses at each one.
UPDATE "LocationLink" AS l
SET "tightSqueeze" = true
FROM "Location" AS a, "Location" AS b
WHERE a."id" = l."aId"
  AND b."id" = l."bId"
  AND (
       (a."slug", b."slug") IN (('caves-4', 'caves-5'), ('depths-3', 'depths-4'), ('depths-5', 'depths-6'))
    OR (b."slug", a."slug") IN (('caves-4', 'caves-5'), ('depths-3', 'depths-4'), ('depths-5', 'depths-6'))
  );
