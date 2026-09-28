-- What characters DO goes into the archive beside what they say: every verb,
-- every Move, and what the GM and the engine did to a character as a result
-- (docs/systemdocs/ARCHIVE.md). Never on a feed: an ACTION row has no placeKey.
ALTER TYPE "ArchiveKind" ADD VALUE 'ACTION';

-- The audit row behind an ACTION line: { type, details, targetId, targetName,
-- locationName }, what /archive needs to draw it as a sentence.
ALTER TABLE "ArchiveEntry" ADD COLUMN "action" JSONB;
