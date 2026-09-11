-- Room.seededStashSlugs: which docs/zones.yaml stash slugs a room has ever
-- been seeded with, so db:sync-zones stops refilling stashes players emptied.
ALTER TABLE "Room" ADD COLUMN "seededStashSlugs" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- Backfill. A slug counts as already seeded when EITHER the room still holds
-- it, OR the audit log shows somebody carried it out of this room. The second
-- clause is load-bearing: on the live game 22 authored stash lines had no row
-- left precisely because players had taken them, and a backfill keyed only on
-- surviving rows would re-seed exactly those on the next sync — the bug this
-- migration exists to close.
UPDATE "Room" r
SET "seededStashSlugs" = COALESCE(seeded.slugs, ARRAY[]::TEXT[])
FROM (
  SELECT room_id, ARRAY_AGG(DISTINCT slug) AS slugs
  FROM (
    -- still on the floor
    SELECT rt."roomId" AS room_id, t."slug" AS slug
    FROM "RoomTag" rt
    JOIN "Tag" t ON t."id" = rt."tagId"
    UNION
    -- carried off at some point: details->from is this room, details->tagId
    -- names the tag
    SELECT a."details"->'from'->>'id' AS room_id, t."slug" AS slug
    FROM "AuditLog" a
    JOIN "Tag" t ON t."id" = a."details"->>'tagId'
    WHERE a."actionType" = 'request_transfer_tag'
      AND a."details"->'from'->>'kind' = 'room'
  ) AS seen
  WHERE room_id IS NOT NULL
  GROUP BY room_id
) AS seeded
WHERE r."id" = seeded.room_id;

ALTER TABLE "Room" ALTER COLUMN "seededStashSlugs" SET NOT NULL;
