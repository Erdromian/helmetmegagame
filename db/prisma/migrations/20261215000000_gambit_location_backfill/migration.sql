-- The adjudication desk now labels a Move with the Location it was FILED from
-- (Action.locationId, stamped by db/lib/moves.js#fileMove), not with wherever the
-- character is standing when the GM looks (web/lib/moveRows.js#moveWhere).
--
-- Nothing here changes the schema. Player-filed Moves have carried that stamp since
-- 20260909120000_action_location, so a Gambit the player filed is already right. The
-- Moves the GAME files for a player — a confession, a lesson, a heal Gambit, a turn a
-- GM spends — never stamped one, and now do (confession.js, lessons.js, medical.js,
-- the Dev Panel's Spend turn). This backfills the same gap for the ones on today's
-- open turn, so they stop following the character the moment this deploys.
--
-- What it can and cannot know. No table records where a character stood at a past
-- moment, so the filing-time Location of an unstamped Move is not recoverable. The
-- best evidence left is where the character stands NOW, and it is used only when it
-- cannot contradict the stamp the row already has: the Move's zoneId (also stamped at
-- filing) must still be the character's zone. A character who has since crossed into
-- another zone keeps a NULL and the desk falls back to the live place for it, exactly
-- as before. A closed turn is left alone: its desk row is history, and a guess
-- stamped onto it would read as a record.
--
-- Additive and idempotent: it only fills NULLs, so a second run changes nothing, and
-- it writes no column Action_notify watches, so no open desk is woken by it. The
-- travel stub (auto:zone_change) is skipped on purpose — its zoneId is the SEAT zone,
-- which is not the presence zone the character's own zoneId holds.
UPDATE "Action" AS a
SET "locationId" = c."locationId"
FROM "Character" AS c, "Turn" AS t
WHERE a."characterId" = c."id"
  AND a."turnId" = t."id"
  AND t."status" = 'OPEN'
  AND a."type" = 'MOVE'
  AND a."locationId" IS NULL
  AND a."zoneId" IS NOT NULL
  AND a."zoneId" = c."zoneId"
  AND c."locationId" IS NOT NULL
  AND COALESCE(a."gmNotes", '') <> 'auto:zone_change';
