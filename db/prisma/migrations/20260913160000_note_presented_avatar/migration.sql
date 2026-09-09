-- The face beside a starred line, frozen the way ArchiveEntry.presentedAvatarPath is.
--
-- A note is filed under the name the room HEARD (Note.characterName holds the
-- alias for a hooded line), but the page drew /api/avatar/<characterId> beside
-- it -- so a line starred from a masked speaker showed their real face next to
-- "a young man". This is the other half of the name.
--
-- Additive, no backfill. A note taken before this column cannot know what was
-- over the face then, and gets the question-mark plate rather than a guess.
ALTER TABLE "Note" ADD COLUMN "presentedAvatarPath" TEXT;
