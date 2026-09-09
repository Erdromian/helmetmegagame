-- Intercept is anchored to one place, and leaving cancels it
-- (docs/systemdocs/INTERCEPT.md §1).

-- 1. A watch now stores WHERE it is watching. Every existing row is anchored to
--    wherever its owner is standing right now — there is no older location to
--    recover, and it is what the watch meant under the old live-read rule
--    anyway. Character.locationId is nullable, so a watch belonging to somebody
--    standing nowhere is dropped rather than anchored to nothing.
ALTER TABLE "InterceptWatch" ADD COLUMN "locationId" TEXT;

UPDATE "InterceptWatch" w
   SET "locationId" = c."locationId"
  FROM "Character" c
 WHERE c."id" = w."characterId";

DELETE FROM "InterceptWatch" WHERE "locationId" IS NULL;

ALTER TABLE "InterceptWatch" ALTER COLUMN "locationId" SET NOT NULL;

CREATE INDEX "InterceptWatch_locationId_idx" ON "InterceptWatch"("locationId");

ALTER TABLE "InterceptWatch"
  ADD CONSTRAINT "InterceptWatch_locationId_fkey"
  FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 2. The once-per-turn catch belongs to the CATCHER, not to the watch row.
--    Watches are churn now — leaving deletes one — and a ration keyed to the
--    row would be reset by walking out and back. watchId -> interceptorId,
--    mapped through the watch's owner; a hit whose watch is already gone has no
--    owner to map to and goes with it.
ALTER TABLE "InterceptHit" DROP CONSTRAINT "InterceptHit_watchId_fkey";
DROP INDEX "InterceptHit_watchId_targetCharacterId_turnId_key";

ALTER TABLE "InterceptHit" RENAME COLUMN "watchId" TO "interceptorId";

UPDATE "InterceptHit" h
   SET "interceptorId" = w."characterId"
  FROM "InterceptWatch" w
 WHERE w."id" = h."interceptorId";

DELETE FROM "InterceptHit" h
 WHERE NOT EXISTS (SELECT 1 FROM "Character" c WHERE c."id" = h."interceptorId");

CREATE UNIQUE INDEX "InterceptHit_interceptorId_targetCharacterId_turnId_key"
  ON "InterceptHit"("interceptorId", "targetCharacterId", "turnId");

ALTER TABLE "InterceptHit"
  ADD CONSTRAINT "InterceptHit_interceptorId_fkey"
  FOREIGN KEY ("interceptorId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;
