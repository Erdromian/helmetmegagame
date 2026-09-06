-- Two fixes from the verify pass on 20260911010000_retire_requests.

-- 1. The medic's per-turn cure cap counted the wrong person. When the ration
--    moved off the Request table it started counting AuditLog.targetCharacterId
--    — which for a heal is the PATIENT, not the medic. A medic treating other
--    people was never counted (no cap at all), and a patient who had been
--    treated could not treat anyone. It counts actorDiscordUserId now, which
--    needs its own composite index; the target-keyed one still serves crafting,
--    where the crafter IS the target.
CREATE INDEX "AuditLog_actorDiscordUserId_actionType_turnId_idx"
  ON "AuditLog"("actorDiscordUserId", "actionType", "turnId");

-- 2. Offer.reason is dead. Nothing has collected a reason since player actions
--    stopped being Requests, so every write was null and two audit rows copied
--    that null back out as though it were a justification.
ALTER TABLE "Offer" DROP COLUMN "reason";
