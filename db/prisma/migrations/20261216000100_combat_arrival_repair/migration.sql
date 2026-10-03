-- Repairs the RECORD of everybody a fight threw straight back out the moment they walked into it
-- (docs/systemdocs/ATTACK.md §7). Data only; no schema change.
--
-- The bug: somebody who joined a fight by walking in — an escort stepping in behind their charge
-- (combat.js#escortsArrive), or a traveller walking into an ambush (combat.js#springAmbush) — was put in
-- the fight by locationTravel.js#performLocationMove, and then the arrival's own side effects
-- (locationMove.js#applyArrivalFacts) ran combat.js#leaveCombatsFor(…, "moved") on them, which never asked
-- whether the fight was at the place they had just arrived. Their row went straight to LEFT / "moved", and
-- the GM's Combat desk showed them greyed out as having left a fight they had just stepped into.
--
-- Bascinet's call (2026-10-03): fix the record only. These rows are put back as fighters, so the desk,
-- History and the spectators' Actions page show who really came into the fight. Nothing else is touched:
-- `activeTurnId` stays null, so nobody is pulled back into a fight or held again, and every fight keeps
-- the end it had (`Combat.endedAt` / `endReason`), even one that ended because of this. On the open turn
-- such a person can still press Join on that fight; combat.js#intervene treats a row with no
-- `activeTurnId` as out of the fight.
--
-- Which rows: LEFT for "moved" within two minutes of joining. The ejection happened inside the same
-- request that joined them (a multi-hop walk included), so it lands within seconds; a real relocation
-- — a GM teleport, a Bulk Move, a staged Relocate to, a rite — of somebody who had joined a fight under
-- two minutes earlier is not a thing that happens. Idempotent: a repaired row is no longer LEFT.
UPDATE "CombatParticipant"
SET status = 'JOINED',
    "leftAt" = NULL,
    "leftReason" = NULL
WHERE status = 'LEFT'
  AND "leftReason" = 'moved'
  AND "leftAt" IS NOT NULL
  AND "leftAt" <= "joinedAt" + interval '2 minutes';
