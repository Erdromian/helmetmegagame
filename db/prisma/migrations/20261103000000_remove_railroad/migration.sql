-- The rail tunnel from the Depot to the Chasm is gone, and the railroad flag
-- with it. The cargo train still runs; it just never meets anybody.
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
       (a."slug", b."slug") = ('undertown-5', 'depths-7')
    OR (b."slug", a."slug") = ('undertown-5', 'depths-7')
  );

-- No edge was ever flagged but that one.
ALTER TABLE "LocationLink" DROP COLUMN "railroad";
