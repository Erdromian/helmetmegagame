-- The walk cooldown drops from 60s to 3s (MAP.md). The registry default only
-- reaches a fresh database, so the live row needs saying out loud.
--
-- The mechanism is untouched: the conditional updateMany in
-- db/lib/locationTravel.js is still what stops two clicks in one tick from
-- both landing, which matters more now that picking a place twice travels.
UPDATE "GameConfig" SET "locationMoveCooldownSeconds" = 3 WHERE "id" = 1;
