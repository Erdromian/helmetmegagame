-- The Alleys no longer open onto the Smithies. Both are still a step from
-- the Residences, so nobody is stranded; it is just one more hop.
--
-- db:import-zones only ever adds edges, so taking the pair out of
-- docs/zones.yaml never reaches a database that already has it. This deletes
-- it by its two ends, in either order. On a fresh database it matches nothing.
-- Nothing holds a foreign key to LocationLink, so there is nothing else to
-- clear first.
DELETE FROM "LocationLink" AS l
USING "Location" AS a, "Location" AS b
WHERE a."id" = l."aId"
  AND b."id" = l."bId"
  AND (
       (a."slug", b."slug") = ('town-5', 'town-6')
    OR (b."slug", a."slug") = ('town-5', 'town-6')
  );
