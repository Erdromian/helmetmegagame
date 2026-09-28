-- Both manned gates are born shut: the Bridge–Square gate (its lever is in
-- the Town Gatehouse's Gate Controls) and the portcullis between the
-- Residences and the Courtyard. docs/zones.yaml says `open: false` for both,
-- but db:import-zones never rewrites a link that already exists, so the born
-- value is written here.
--
-- Only authoredOpen changes. isOpen is play state: a game in progress keeps
-- its gates as they stand, and the next Restart Game shuts them.
UPDATE "LocationLink" AS l
SET "authoredOpen" = false
FROM "Location" AS a, "Location" AS b
WHERE a."id" = l."aId"
  AND b."id" = l."bId"
  AND (
       (a."slug", b."slug") IN (('bridge', 'town-2'), ('fortress-2', 'town-8'))
    OR (b."slug", a."slug") IN (('bridge', 'town-2'), ('fortress-2', 'town-8'))
  );
