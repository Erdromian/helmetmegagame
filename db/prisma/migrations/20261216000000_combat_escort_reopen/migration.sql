-- Three columns for the GM's Combat lens (docs/systemdocs/ATTACK.md §6a, §8). Additive: nothing is dropped
-- or rewritten, and all three are nullable, so a fight live on the turn this deploys carries on as it was.
--
-- `prisma migrate diff` also proposes dropping the raw-SQL indexes and partial uniques Prisma cannot see
-- (CLAUDE.md, "Notes for future work"). Those drops are declined here, as in every migration.

-- When somebody came into a fight after a GM had solved it (combat.js#reopenIfSolved, Bascinet
-- 2026-10-03): the Solved stamp comes off, and this marks it Reopened on the desk.
ALTER TABLE "Combat" ADD COLUMN IF NOT EXISTS "reopenedAt" TIMESTAMP(3);

-- An escort who stepped in for their charge: the charge's character id, so the desk can say whom they
-- came to defend. A plain id, no foreign key (the log-table rule, ARCHITECTURE.md).
ALTER TABLE "CombatParticipant" ADD COLUMN IF NOT EXISTS "escortOfId" TEXT;

-- Somebody back in a fight they had been out of (combat.js#intervene): 'DECLINED' or 'LEFT'. Null for
-- everybody who came into it once. Nothing earlier recorded it, so there is nothing to backfill.
ALTER TABLE "CombatParticipant" ADD COLUMN IF NOT EXISTS "cameBackFrom" "CombatStatus";

-- Best effort for the fights on the turn that is open now, the only ones a GM is still ruling on: an
-- intervener on the defending side who is, right now, escorting somebody defending in that same fight
-- stepped in for them. Earlier turns are left blank rather than guessed at — an escort may have changed
-- charges since.
UPDATE "CombatParticipant" AS p
SET "escortOfId" = c."guardingId"
FROM "Character" AS c, "Combat" AS f, "Turn" AS t
WHERE p."characterId" = c.id
  AND p."combatId" = f.id
  AND f."turnId" = t.id
  AND t.status = 'OPEN'
  AND p.role = 'INTERVENER'
  AND p.side = 'DEFENDER'
  AND p."escortOfId" IS NULL
  AND c."guardingId" IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM "CombatParticipant" AS charge
    WHERE charge."combatId" = p."combatId"
      AND charge."characterId" = c."guardingId"
      AND charge.side = 'DEFENDER'
  );
