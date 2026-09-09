-- The archive packet (docs/systemdocs/ARCHIVE.md).
--
-- Additive only: four nullable columns on Game. `exportKey`/`entryCount` say a
-- packet exists and how big it was; `archivedAt` says the ArchiveEntry rows
-- have LEFT the database, which is what makes /archive draw the epilogue stub
-- instead of an empty transcript. `label` is what a reader sees instead of the
-- number, which stopped being shown once it reached 13 before launch.
ALTER TABLE "Game" ADD COLUMN "label" TEXT;
ALTER TABLE "Game" ADD COLUMN "exportKey" TEXT;
ALTER TABLE "Game" ADD COLUMN "entryCount" INTEGER;
ALTER TABLE "Game" ADD COLUMN "archivedAt" TIMESTAMP(3);

-- The seq the packet reaches to. Bounds the wipe's delete, so a row written
-- between the export and the wipe is never destroyed without having been in
-- the file.
ALTER TABLE "Game" ADD COLUMN "exportMaxSeq" BIGINT;
