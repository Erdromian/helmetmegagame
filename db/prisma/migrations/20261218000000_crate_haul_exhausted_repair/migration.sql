-- Repairs the Exhausted that hauling a crate handed out on the open turn (docs/systemdocs/CARRY.md §10).
-- Data only; no schema change.
--
-- The bug: db/lib/crateHaul.js steps somebody up the Tired ladder the moment they move a crate, partway
-- through a turn, but stamped the tag as a turn CLOSE does — first live turn N+1. An Exhausted from a
-- haul on turn N therefore held the rest of N and all of N+1: a "2t" badge, two turns locked out of
-- Mining, Refine and Farming. It now lasts the rest of the turn it lands in and turns back into Tired at
-- the push, like every other Exhausted covers one turn.
--
-- Which rows: Exhausted stamped past the open turn, on somebody who hauled a crate this turn
-- (Character."crateHauledTurn"). Nothing granted at a turn close can be past the open turn — the close
-- stamps the turn it opens — so those rows can only have come from a mid-turn grant. Pushing on through
-- a travel gate is the other one, and its N+1 is deliberate (db/lib/locationTravel.js#pushOn), so anybody
-- who pushed on this turn is left alone. A haul on an EARLIER turn needs nothing: that row now reads
-- "Expires this turn", which is the length it should have had.
--
-- With no turn open (mid-advance) it touches nothing. Idempotent: a repaired row is no longer past the
-- open turn.
UPDATE "CharacterTag" ct
SET "expiresTurn" = t."number"
FROM "Tag" tg, "Turn" t, "Character" c
WHERE tg."id" = ct."tagId"
  AND tg."slug" = 'exhausted'
  AND t."status" = 'OPEN'
  AND c."id" = ct."characterId"
  AND c."crateHauledTurn" = t."number"
  AND ct."expiresTurn" > t."number"
  AND NOT EXISTS (
    SELECT 1
    FROM "AuditLog" a
    WHERE a."actionType" = 'exert_crossing'
      AND a."turnId" = t."id"
      AND a."targetCharacterId" = c."id"
  );
