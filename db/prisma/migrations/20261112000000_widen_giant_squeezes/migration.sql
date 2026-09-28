-- Widen two of the three tight squeezes back into plain ways.
--
-- The Brooding Grounds (caves-4 <-> caves-5) cost a Giant a six-hop detour,
-- and the Razor Tunnels (depths-5 <-> depths-6) shut a Giant without climbing
-- out of the Crystal Chambers and the Chasm altogether. db:import-zones never
-- updates an edge that already exists, so dropping `tight_squeeze: true` from
-- docs/zones.yaml does not reach a database that has these edges; this does.
-- On a fresh database it matches nothing. The one squeeze left is
-- depths-3 <-> depths-4. See MAP.md's "Tight squeeze" section.
UPDATE "LocationLink" AS l
SET "tightSqueeze" = false
FROM "Location" AS a, "Location" AS b
WHERE a."id" = l."aId"
  AND b."id" = l."bId"
  AND (
       (a."slug", b."slug") IN (('caves-4', 'caves-5'), ('depths-5', 'depths-6'))
    OR (b."slug", a."slug") IN (('caves-4', 'caves-5'), ('depths-5', 'depths-6'))
  );
