-- Disguises are named per reader (docs/systemdocs/STRANGERS.md §10).
--
-- A Friends entry learned for a disguise's name has no subject; it recognises
-- the disguise by the bare name's key. One such entry per owner and name.
ALTER TABLE "Acquaintance" ADD COLUMN "disguiseKey" TEXT;
CREATE UNIQUE INDEX "Acquaintance_ownerId_disguiseKey_key" ON "Acquaintance"("ownerId", "disguiseKey");

-- Whether a line's concealedAlias was a Disguise Kit's name. Every existing
-- row reads false, which is how it was read before: a public name.
ALTER TABLE "ArchiveEntry" ADD COLUMN "disguised" BOOLEAN NOT NULL DEFAULT false;

-- The job a disguise claims, as a Role slug on its minted tag, and that job's
-- estate frozen on each line said in it. Null for no job.
ALTER TABLE "Tag" ADD COLUMN "disguiseJobSlug" TEXT;
ALTER TABLE "ArchiveEntry" ADD COLUMN "disguiseGroup" TEXT;
