-- The face the room SAW, frozen beside the name it heard (ArchiveEntry.concealedAlias).
-- Null means the character's own face, resolved live from /api/avatar/<id>.
--
-- Additive, no backfill. A row written before this column cannot know what was
-- over the face then -- the sprite lived on the Tag that was equipped at the
-- time, and guessing from today's tags could unmask somebody. Those rows are
-- answered with /assets/unknown.png by db/lib/archive.js#feedRowShape instead.
ALTER TABLE "ArchiveEntry" ADD COLUMN "presentedAvatarPath" TEXT;
