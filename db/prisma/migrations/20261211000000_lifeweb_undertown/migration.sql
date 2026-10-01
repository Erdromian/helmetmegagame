-- The Lifeweb can be tended again (docs/systemdocs/REQUESTS.md §5a).
--
-- /lifeweb's Donate Blood and Feed Person used to need the Mortus standing in
-- the Fortress zone. The Lifeweb moved out of the Fortress into the Undertown
-- (undertown-3), so no Mortus could stand there and both buttons stayed grey.
-- The gate now reads a `lifeweb` Location attribute instead of a zone, and
-- docs/zones.yaml puts it on the Lifeweb.
--
-- db:import-zones never updates a place that already exists, so the running
-- game's row is marked here. It adds the one key and leaves every other
-- attribute (noBuild, a GM's own edit) alone; a no-op where it is already set.
UPDATE "Location"
SET "attributes" = "attributes" || '{"lifeweb": true}'::jsonb
WHERE "slug" = 'undertown-3'
  AND NOT ("attributes" ? 'lifeweb');
