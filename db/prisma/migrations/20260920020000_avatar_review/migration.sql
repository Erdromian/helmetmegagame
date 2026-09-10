-- The uploaded-avatar review queue (docs/systemdocs/PORTRAITS.md §1a).
--
-- Additive: two nullable columns, nothing dropped, nothing rewritten.
ALTER TABLE "Character" ADD COLUMN "avatarSetAt" TIMESTAMP(3);
ALTER TABLE "Character" ADD COLUMN "avatarReviewedAt" TIMESTAMP(3);

-- Backfill the pictures that are ALREADY in the game, so they get a first
-- review instead of being invisible to the queue forever. `portrait IS NULL`
-- beside a non-null avatarData is what makes a row an upload rather than a
-- portrait-maker render — the maker always stores its selection there.
--
-- updatedAt is the best timestamp available for these: it is not when the
-- picture was set, but it is never earlier, and the only thing it decides is
-- the order they are read in.
UPDATE "Character"
   SET "avatarSetAt" = "updatedAt"
 WHERE "avatarData" IS NOT NULL
   AND "portrait" IS NULL;
