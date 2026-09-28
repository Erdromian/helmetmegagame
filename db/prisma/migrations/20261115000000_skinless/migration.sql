-- The Skinless (db/lib/skinless.js, docs/systemdocs/SKINLESS.md): a lateparty
-- that names them picks one random Depths Location when it opens, and every
-- Skinless it makes arrives there.
ALTER TABLE "LateParty" ADD COLUMN "skinlessLocationId" TEXT;

ALTER TABLE "LateParty" ADD CONSTRAINT "LateParty_skinlessLocationId_fkey" FOREIGN KEY ("skinlessLocationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;
