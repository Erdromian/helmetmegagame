-- The Cathedral's Order Chambers room (town-4-3) is gone. The Order has its own
-- Location now, the Order Chambers (undertown-b), under the Cathedral. The YAML
-- only reaches a place that does not exist yet (db:import-zones never updates
-- or deletes), so a running game needs the change written here.

-- Retire the room, the way /gm/dev/zones does (db/lib/placeDeletable.js). The
-- row stays and can be brought back; it drops out of every picker, the map and
-- the Discord mirror. Nobody stands in a Room, so nobody is stranded.
UPDATE "Room"
SET "retiredAt" = CURRENT_TIMESTAMP
WHERE "slug" = 'town-4-3'
  AND "retiredAt" IS NULL;

-- The old room was soundproof. Its job, the Order's torture room, is the
-- Interrogation Room's now, so that room takes the soundproofing.
UPDATE "Room"
SET "soundproof" = true
WHERE "slug" = 'undertown-b-1';

-- The old room's phonebook moves to the Order Barracks, the locked room where
-- the rest of its stash already is. The next Start Game or wipe pours it
-- (db/lib/roomStashSeed.js); only where the seed does not name it already, so
-- a second run changes nothing. The shape is 20261101000000_phone_overhaul's.
UPDATE "Room" AS r
SET "stashSeed" = jsonb_set(
  COALESCE(r."stashSeed"::jsonb, '{}'::jsonb),
  '{items}',
  COALESCE(r."stashSeed"::jsonb -> 'items', '[]'::jsonb) || '[["phonebook", 1]]'::jsonb,
  true
)
WHERE r."slug" = 'undertown-b-3'
AND NOT EXISTS (
  SELECT 1
  FROM jsonb_array_elements(COALESCE(r."stashSeed"::jsonb -> 'items', '[]'::jsonb)) AS e(item)
  WHERE e.item #>> '{0}' = 'phonebook' OR e.item #>> '{}' = 'phonebook'
);

-- ─── The Bishop's ring ──────────────────────────────────────────────────────

-- bishops-key opened the old room and nothing else. The Bishop's ring carries
-- order-key in its place (docs/roles.yaml), so the Bishop uses the Order's own
-- doors. db:sync-deploy does not sync roles, so the Role row is written here.
-- Sorted by code point, as db/lib/syncRoles.js#ringAccessFor sorts.
UPDATE "Role"
SET "ringAccessSlugs" = ARRAY(
  SELECT DISTINCT tok COLLATE "C"
  FROM unnest(array_remove("ringAccessSlugs", 'bishops-key') || ARRAY['order-key']::TEXT[]) AS tok
  ORDER BY 1
)
WHERE "slug" = 'bishop';

-- The rings already on fingers carry a copy of their seats' tokens, so they
-- follow: db/lib/syncRoles.js#refreshRingAccess, in SQL, the same as
-- 20261114000000_gatehouse_rework.
UPDATE "Tag" AS t
SET "ringAccessSlugs" = ARRAY(
  SELECT DISTINCT tok COLLATE "C"
  FROM "Role" AS r, unnest(r."ringAccessSlugs") AS tok
  WHERE r."slug" = ANY(t."ringRoleSlugs")
  ORDER BY 1
)
WHERE t."ringOfCharacterId" IS NOT NULL
  AND t."ringRegisteredAt" IS NOT NULL
  AND t."ringRoleSlugs" && ARRAY['bishop']::TEXT[];
