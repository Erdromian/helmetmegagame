-- Disguises are named per reader (docs/systemdocs/STRANGERS.md §10).
--
-- A Friends entry learned for a disguise's name has no subject; it recognises
-- the disguise by the bare name's key. One such entry per owner and name.
ALTER TABLE "Acquaintance" ADD COLUMN "disguiseKey" TEXT;
CREATE UNIQUE INDEX "Acquaintance_ownerId_disguiseKey_key" ON "Acquaintance"("ownerId", "disguiseKey");

-- Whether a line's concealedAlias was a Disguise Kit's name. Every existing
-- row reads false, which is how it was read before: a public name.
ALTER TABLE "ArchiveEntry" ADD COLUMN "disguised" BOOLEAN NOT NULL DEFAULT false;

-- The job a disguise claims on its minted tag: its title, real or made up, and
-- the Role slug when it names a real one. That seat's estate is frozen on each
-- line said in it. Null for no job, and the slug and estate for a made-up one.
ALTER TABLE "Tag" ADD COLUMN "disguiseJob" TEXT;
ALTER TABLE "Tag" ADD COLUMN "disguiseJobSlug" TEXT;
ALTER TABLE "ArchiveEntry" ADD COLUMN "disguiseGroup" TEXT;
