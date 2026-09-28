-- Who personally witnessed each archive row, frozen as it is written, for
-- /archive's "Witnessed by" filter (docs/systemdocs/ARCHIVE.md). Two parallel
-- arrays: the ids to filter on, and the real names to show in the picker.
--
-- No backfill. Rows written before this have empty arrays, so a Witnessed by
-- filter leaves them out.
ALTER TABLE "ArchiveEntry" ADD COLUMN "witnessIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "ArchiveEntry" ADD COLUMN "witnessNames" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- A GIN index, so "witnessed by any of these" is an index lookup and not a scan.
CREATE INDEX "ArchiveEntry_witnessIds_idx" ON "ArchiveEntry" USING GIN ("witnessIds");
